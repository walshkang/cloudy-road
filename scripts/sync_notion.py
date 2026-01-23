import json
import logging
import os
import sys
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional, Tuple

import httpx
from notion_client import Client
from notion_client.errors import APIResponseError


logger = logging.getLogger(__name__)


DEFAULT_NOTION_ID_PROPERTY = "ID"

# Default property mapping from roadmap fields to Notion property names
DEFAULT_PROPERTY_MAPPING = {
    "id": "ID",
    "title": "Task",
    "status": "Status",
    "priority": "Priority",
    "owner": "Owner",
    "phase": "Phase",
    "epic": "Epic",
    "description": "Description",
    "dependencies": "Dependencies",
}

# Expected Notion property types for each roadmap field (allows flexibility)
EXPECTED_TYPES = {
    "id": ["rich_text", "title"],       # ID can be text or title column
    "title": ["title"],                  # Must be the title property
    "status": ["status", "select"],      # Allow status or select
    "priority": ["select"],
    "owner": ["select", "people"],       # Allow upgrade to people later
    "phase": ["select"],
    "epic": ["select"],
    "description": ["rich_text"],
    "dependencies": ["rich_text", "relation"],  # Text or relation
}


@dataclass
class Task:
    id: str
    title: str
    status: str
    priority: str
    owner: str
    description: str
    dependencies: List[str]
    phase_name: str
    epic_title: str


class RoadmapLoadError(Exception):
    pass


class SchemaValidationError(Exception):
    """Raised when the Notion database schema doesn't match expected structure."""
    pass


# =============================================================================
# Schema Discovery & Validation
# =============================================================================

def get_database_schema(notion_client: Client, database_id: str) -> Dict[str, Any]:
    """
    Fetches database schema and returns property definitions.
    
    Returns:
        Dict mapping property name -> property definition (including 'type')
    """
    try:
        response = notion_client.databases.retrieve(database_id=database_id)
        return response.get("properties", {})
    except APIResponseError as e:
        logger.error("Failed to fetch database schema:")
        logger.error("  Status: %s", e.status)
        logger.error("  Code: %s", getattr(e, 'code', 'N/A'))
        logger.error("  Body: %s", getattr(e, 'body', str(e)))
        raise


def print_schema(schema: Dict[str, Any]) -> None:
    """Prints the database schema in a readable format."""
    logger.info("=" * 60)
    logger.info("DATABASE SCHEMA")
    logger.info("=" * 60)
    
    # Sort by type for better readability
    by_type: Dict[str, List[str]] = {}
    for name, prop in schema.items():
        prop_type = prop.get("type", "unknown")
        by_type.setdefault(prop_type, []).append(name)
    
    for prop_type in sorted(by_type.keys()):
        logger.info("")
        logger.info("[%s]", prop_type.upper())
        for name in sorted(by_type[prop_type]):
            prop = schema[name]
            extra = ""
            # Show select/status options if available
            if prop_type == "select":
                options = prop.get("select", {}).get("options", [])
                if options:
                    option_names = [o.get("name", "?") for o in options[:5]]
                    if len(options) > 5:
                        option_names.append(f"... +{len(options) - 5} more")
                    extra = f" (options: {', '.join(option_names)})"
            elif prop_type == "status":
                groups = prop.get("status", {}).get("groups", [])
                all_options = []
                for group in groups:
                    all_options.extend(o.get("name", "?") for o in group.get("options", []))
                if all_options:
                    extra = f" (options: {', '.join(all_options[:5])})"
            logger.info("  - %s%s", name, extra)
    
    logger.info("")
    logger.info("=" * 60)


def find_title_property(schema: Dict[str, Any]) -> Optional[str]:
    """
    Find the property with type 'title' (there's exactly one per database).
    
    Returns:
        The name of the title property, or None if not found.
    """
    for name, prop in schema.items():
        if prop.get("type") == "title":
            return name
    return None


def load_config(config_path: Optional[str] = None) -> Dict[str, Any]:
    """
    Load property mapping configuration from a JSON file.
    
    If no config file exists, returns default configuration.
    """
    default_config = {
        "property_mapping": DEFAULT_PROPERTY_MAPPING.copy(),
    }
    
    if config_path is None:
        # Try default location
        script_dir = os.path.dirname(os.path.abspath(__file__))
        config_path = os.path.join(script_dir, "notion_config.json")
    
    if not os.path.exists(config_path):
        logger.debug("No config file at %s, using defaults", config_path)
        return default_config
    
    try:
        with open(config_path, "r", encoding="utf-8") as f:
            config = json.load(f)
        logger.info("Loaded config from %s", config_path)
        
        # Merge with defaults for any missing keys
        if "property_mapping" not in config:
            config["property_mapping"] = default_config["property_mapping"]
        else:
            # Fill in any missing mappings from defaults
            for key, value in default_config["property_mapping"].items():
                if key not in config["property_mapping"]:
                    config["property_mapping"][key] = value
        
        return config
    except json.JSONDecodeError as e:
        logger.warning("Failed to parse config file %s: %s. Using defaults.", config_path, e)
        return default_config
    except Exception as e:
        logger.warning("Failed to load config file %s: %s. Using defaults.", config_path, e)
        return default_config


def validate_schema(
    schema: Dict[str, Any],
    config: Dict[str, Any],
) -> List[str]:
    """
    Validates that the Notion database schema matches the expected structure.
    
    Returns:
        List of error messages (empty if validation passes).
    """
    errors: List[str] = []
    property_mapping = config.get("property_mapping", DEFAULT_PROPERTY_MAPPING)
    
    for field, notion_prop in property_mapping.items():
        # Check existence
        if notion_prop not in schema:
            errors.append(f"Property '{notion_prop}' (for '{field}') not found in database")
            continue
        
        # Check type compatibility
        actual_type = schema[notion_prop].get("type")
        expected_types = EXPECTED_TYPES.get(field, [])
        
        if expected_types and actual_type not in expected_types:
            errors.append(
                f"Property '{notion_prop}' is type '{actual_type}', "
                f"but '{field}' expects one of: {expected_types}"
            )
    
    return errors


def load_local_roadmap(filepath: str) -> Dict[str, Any]:
    """
    Loads the roadmap.json file and returns its parsed content.
    Raises RoadmapLoadError on failure.
    """
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError as exc:
        raise RoadmapLoadError(f"Roadmap file not found at {filepath}") from exc
    except json.JSONDecodeError as exc:
        raise RoadmapLoadError(f"Could not decode JSON from {filepath}") from exc

    if not isinstance(data, dict):
        raise RoadmapLoadError("Expected roadmap root to be an object")

    return data


def flatten_roadmap(roadmap_data: Dict[str, Any]) -> List[Task]:
    """
    Flattens the roadmap structure into a list of Task objects.

    Expected schema:
    {
        "phases": [
            {
                "phaseName": "...",
                "epics": [
                    {
                        "epicTitle": "...",
                        "tasks": [ { task fields... }, ... ]
                    }
                ]
            }
        ]
    }
    """
    tasks: List[Task] = []

    phases = roadmap_data.get("phases") or []
    if not isinstance(phases, list):
        raise RoadmapLoadError("Expected 'phases' to be a list")

    for phase in phases:
        phase_name = phase.get("phaseName", "")
        epics = phase.get("epics") or []
        if not isinstance(epics, list):
            raise RoadmapLoadError("Expected 'epics' to be a list in each phase")

        for epic in epics:
            epic_title = epic.get("epicTitle", "")
            raw_tasks = epic.get("tasks") or []
            if not isinstance(raw_tasks, list):
                raise RoadmapLoadError("Expected 'tasks' to be a list in each epic")

            for raw_task in raw_tasks:
                task_id = (raw_task or {}).get("id")
                title = (raw_task or {}).get("title")
                if not task_id or not isinstance(task_id, str):
                    logger.warning("Skipping task with invalid or missing id: %r", raw_task)
                    continue
                if not title or not isinstance(title, str):
                    logger.warning("Skipping task with invalid or missing title: %r", raw_task)
                    continue

                status = (raw_task or {}).get("status", "Not Started")
                priority = (raw_task or {}).get("priority", "Medium")
                owner = (raw_task or {}).get("owner", "Full Stack")
                description = (raw_task or {}).get("description", "")
                dependencies = raw_task.get("dependencies") or []
                if not isinstance(dependencies, list):
                    logger.warning(
                        "Task %s has non-list dependencies; coercing to empty list", task_id
                    )
                    dependencies = []

                tasks.append(
                    Task(
                        id=task_id,
                        title=title,
                        status=status,
                        priority=priority,
                        owner=owner,
                        description=description,
                        dependencies=[str(d) for d in dependencies],
                        phase_name=str(phase_name),
                        epic_title=str(epic_title),
                    )
                )

    return tasks


def get_existing_pages(
    notion_client: Client,
    database_id: str,
    id_property_name: str = DEFAULT_NOTION_ID_PROPERTY,
) -> Dict[str, Dict[str, Any]]:
    """
    Fetches all pages from the database and maps them by their Task ID.

    Returns:
        Dict[task_id, page_object]
    """
    page_map: Dict[str, Dict[str, Any]] = {}
    has_more = True
    start_cursor: Optional[str] = None

    while has_more:
        try:
            # Fallback to direct httpx call to bypass notion-client issues with this specific endpoint
            url = f"https://api.notion.com/v1/databases/{database_id}/query"
            headers = {
                "Authorization": f"Bearer {notion_client.options.auth}",
                "Notion-Version": "2022-06-28", # Force older version to avoid invalid_request_url 400 error
                "Content-Type": "application/json",
            }
            
            # Ensure body is not empty to avoid 400 Bad Request on newer API versions
            json_body = {"page_size": 100}
            if start_cursor:
                json_body["start_cursor"] = start_cursor

            # Use httpx.Client() context manager to ensure proper cleanup if we were doing this repeatedly,
            # but here a simple post is fine.
            # Note: notion_client uses httpx under the hood, so we reuse the library.

            http_response = httpx.post(url, headers=headers, json=json_body, timeout=60.0)
            http_response.raise_for_status()
            response = http_response.json()

        except httpx.HTTPStatusError as e:
            logger.error("Error fetching existing pages (HTTP %s): %s", e.response.status_code, e.response.text)
            raise APIResponseError(e.response, e.response.text, str(e.response.status_code)) from e
        except Exception as e:
            logger.error("Error fetching existing pages: %s", e)
            raise

        results = response.get("results", [])

        for page in results:
            try:
                properties = page.get("properties", {})
                task_id_prop = properties.get(id_property_name, {})
                # Handle both Title and Rich Text types for the ID property
                content_array = task_id_prop.get("title") or task_id_prop.get("rich_text") or []
                
                if not content_array:
                    # It might be empty, which is valid for a new row but we skip for sync matching
                    logger.warning(
                        "Skipping page with ID %s - %s is empty",
                        page.get("id"),
                        id_property_name,
                    )
                    continue
                    
                task_id = content_array[0].get("plain_text")
                if not task_id:
                    logger.warning(
                        "Skipping page with ID %s - %s has no plain_text",
                        page.get("id"),
                        id_property_name,
                    )
                    continue
                page_map[str(task_id)] = page
            except Exception:
                logger.exception("Skipping page with ID %s due to parsing error", page.get("id"))

        has_more = response.get("has_more", False)
        start_cursor = response.get("next_cursor")

    return page_map


def _dependencies_to_multi_select(dependencies: Iterable[str]) -> List[Dict[str, str]]:
    return [{"name": d} for d in dependencies if d]


def format_notion_properties(
    task: Task,
    config: Dict[str, Any],
    schema: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Formats a Task into the Notion API's property structure.
    
    Uses the config to map roadmap fields to Notion property names,
    and optionally uses schema to determine correct payload types.
    """
    mapping = config.get("property_mapping", DEFAULT_PROPERTY_MAPPING)
    
    # Helper to get property type from schema
    def get_prop_type(field: str) -> Optional[str]:
        if schema is None:
            return None
        prop_name = mapping.get(field)
        if prop_name and prop_name in schema:
            return schema[prop_name].get("type")
        return None
    
    properties: Dict[str, Any] = {}
    
    # ID field - can be rich_text or title
    id_prop_name = mapping.get("id", "ID")
    id_type = get_prop_type("id")
    if id_type == "title":
        properties[id_prop_name] = {
            "title": [{"type": "text", "text": {"content": task.id}}],
        }
    else:
        # Default to rich_text
        properties[id_prop_name] = {
            "rich_text": [{"type": "text", "text": {"content": task.id}}],
        }
    
    # Title field - must be title type
    title_prop_name = mapping.get("title", "Task Name")
    properties[title_prop_name] = {
        "title": [{"type": "text", "text": {"content": task.title}}],
    }
    
    # Status field - can be status or select
    status_prop_name = mapping.get("status", "Status")
    status_type = get_prop_type("status")
    if status_type == "select":
        properties[status_prop_name] = {
            "select": {"name": task.status},
        }
    else:
        # Default to status type
        properties[status_prop_name] = {
            "status": {"name": task.status},
        }
    
    # Priority field - select
    priority_prop_name = mapping.get("priority", "Priority")
    properties[priority_prop_name] = {
        "select": {"name": task.priority},
    }
    
    # Owner field - select (could be people in future)
    owner_prop_name = mapping.get("owner", "Owner")
    properties[owner_prop_name] = {
        "select": {"name": task.owner},
    }
    
    # Phase field - select
    phase_prop_name = mapping.get("phase", "Phase")
    properties[phase_prop_name] = {
        "select": {"name": task.phase_name},
    }
    
    # Epic field - select
    epic_prop_name = mapping.get("epic", "Epic")
    properties[epic_prop_name] = {
        "select": {"name": task.epic_title},
    }
    
    # Description field - rich_text
    desc_prop_name = mapping.get("description", "Description")
    properties[desc_prop_name] = {
        "rich_text": [
            {"type": "text", "text": {"content": task.description or ""}},
        ],
    }
    
    # Dependencies field - rich_text (could be relation in future)
    deps_prop_name = mapping.get("dependencies", "Dependencies")
    deps_type = get_prop_type("dependencies")
    if deps_type == "relation":
        # For relation type, we'd need page IDs - for now, skip if relation
        logger.warning(
            "Dependencies property '%s' is type 'relation'. "
            "Relation sync not yet supported, skipping dependencies.",
            deps_prop_name
        )
    else:
        # Default to rich_text
        properties[deps_prop_name] = {
            "rich_text": [
                {"type": "text", "text": {"content": ", ".join(task.dependencies)}},
            ],
        }
    
    return properties


def _simple_property_view(
    properties: Dict[str, Any],
    config: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Extracts a simplified, comparable view of relevant properties from either:
      - a Notion page's properties dict, or
      - a Notion properties payload about to be sent.
    """
    mapping = config.get("property_mapping", DEFAULT_PROPERTY_MAPPING)

    def _from_title(prop: Dict[str, Any]) -> str:
        arr = prop.get("title") or []
        if not arr:
            return ""
        return arr[0].get("plain_text") or arr[0].get("text", {}).get("content", "")

    def _from_rich_text(prop: Dict[str, Any]) -> str:
        arr = prop.get("rich_text") or []
        if not arr:
            return ""
        return "".join(
            [
                span.get("plain_text")
                or span.get("text", {}).get("content", "")
                or ""
                for span in arr
            ]
        )

    def _from_select(prop: Dict[str, Any]) -> str:
        select = prop.get("select") or {}
        return select.get("name", "") if isinstance(select, dict) else ""

    def _from_multi_select(prop: Dict[str, Any]) -> Tuple[str, ...]:
        items = prop.get("multi_select") or []
        names: List[str] = []
        for item in items:
            name = item.get("name")
            if name:
                names.append(name)
        return tuple(sorted(names))

    def _from_status(prop: Dict[str, Any]) -> str:
        status = prop.get("status") or {}
        return status.get("name", "") if isinstance(status, dict) else ""

    simple: Dict[str, Any] = {}
    
    # ID field - can be rich_text or title
    id_prop_name = mapping.get("id", "ID")
    id_prop = properties.get(id_prop_name) or {}
    # Try both rich_text and title
    simple["id"] = _from_rich_text(id_prop) or _from_title(id_prop)

    # Title field
    title_prop_name = mapping.get("title", "Task Name")
    title = properties.get(title_prop_name) or {}
    simple["title"] = _from_title(title)

    # Status field - can be status or select
    status_prop_name = mapping.get("status", "Status")
    status = properties.get(status_prop_name) or {}
    simple["status"] = _from_status(status) or _from_select(status)

    # Priority field
    priority_prop_name = mapping.get("priority", "Priority")
    priority = properties.get(priority_prop_name) or {}
    simple["priority"] = _from_select(priority)

    # Owner field
    owner_prop_name = mapping.get("owner", "Owner")
    owner = properties.get(owner_prop_name) or {}
    simple["owner"] = _from_select(owner)

    # Phase field
    phase_prop_name = mapping.get("phase", "Phase")
    phase = properties.get(phase_prop_name) or {}
    simple["phase"] = _from_select(phase)

    # Epic field
    epic_prop_name = mapping.get("epic", "Epic")
    epic = properties.get(epic_prop_name) or {}
    simple["epic"] = _from_select(epic)

    # Description field
    desc_prop_name = mapping.get("description", "Description")
    description = properties.get(desc_prop_name) or {}
    simple["description"] = _from_rich_text(description)

    # Dependencies field
    deps_prop_name = mapping.get("dependencies", "Dependencies")
    deps = properties.get(deps_prop_name) or {}
    simple["dependencies"] = _from_rich_text(deps)

    return simple


def needs_update(
    existing_page: Dict[str, Any],
    new_properties: Dict[str, Any],
    config: Dict[str, Any],
) -> bool:
    """
    Compares the relevant properties between an existing Notion page and a new
    properties payload and decides whether an update is needed.
    """
    existing_props = existing_page.get("properties") or {}
    simple_existing = _simple_property_view(existing_props, config)
    simple_new = _simple_property_view(new_properties, config)
    return simple_existing != simple_new


class SyncStats:
    def __init__(self) -> None:
        self.created = 0
        self.updated = 0
        self.skipped = 0
        self.failed = 0

    def as_dict(self) -> Dict[str, int]:
        return {
            "created": self.created,
            "updated": self.updated,
            "skipped": self.skipped,
            "failed": self.failed,
        }


def _get_task_id_from_properties(properties: Dict[str, Any], config: Dict[str, Any]) -> str:
    """Extract task ID from properties payload."""
    mapping = config.get("property_mapping", DEFAULT_PROPERTY_MAPPING)
    id_prop_name = mapping.get("id", "ID")
    id_prop = properties.get(id_prop_name, {})
    
    # Try rich_text first, then title
    if "rich_text" in id_prop and id_prop["rich_text"]:
        return id_prop["rich_text"][0].get("text", {}).get("content", "unknown")
    if "title" in id_prop and id_prop["title"]:
        return id_prop["title"][0].get("text", {}).get("content", "unknown")
    return "unknown"


def create_notion_page(
    notion_client: Client,
    database_id: str,
    properties: Dict[str, Any],
    config: Dict[str, Any],
    dry_run: bool = False,
) -> None:
    """Creates a new page in the Notion database."""
    task_id = _get_task_id_from_properties(properties, config)
    if dry_run:
        logger.info("DRY-RUN: Would create %s", task_id)
        return

    try:
        notion_client.pages.create(parent={"database_id": database_id}, properties=properties)
        logger.info("CREATED: %s", task_id)
    except APIResponseError as e:
        logger.error("=" * 60)
        logger.error("NOTION API ERROR creating task '%s'", task_id)
        logger.error("=" * 60)
        logger.error("  Status: %s", e.status)
        logger.error("  Code: %s", getattr(e, 'code', 'N/A'))
        logger.error("  Body: %s", getattr(e, 'body', str(e)))
        logger.error("")
        logger.error("  HINT: Check that property names and values match your Notion database.")
        logger.error("  Run with --schema to see your database structure.")
        logger.error("=" * 60)
        raise


def update_notion_page(
    notion_client: Client,
    page_id: str,
    properties: Dict[str, Any],
    config: Dict[str, Any],
    dry_run: bool = False,
) -> None:
    """Updates an existing page in the Notion database."""
    task_id = _get_task_id_from_properties(properties, config)
    if dry_run:
        logger.info("DRY-RUN: Would update %s", task_id)
        return

    try:
        notion_client.pages.update(page_id=page_id, properties=properties)
        logger.info("UPDATED: %s", task_id)
    except APIResponseError as e:
        logger.error("=" * 60)
        logger.error("NOTION API ERROR updating task '%s'", task_id)
        logger.error("=" * 60)
        logger.error("  Status: %s", e.status)
        logger.error("  Code: %s", getattr(e, 'code', 'N/A'))
        logger.error("  Body: %s", getattr(e, 'body', str(e)))
        logger.error("")
        logger.error("  HINT: Check that property names and values match your Notion database.")
        logger.error("  Run with --schema to see your database structure.")
        logger.error("=" * 60)
        raise


def sync_roadmap_to_notion(
    *,
    notion_api_key: str,
    notion_database_id: str,
    roadmap_file_path: str,
    config: Optional[Dict[str, Any]] = None,
    dry_run: bool = False,
    skip_validation: bool = False,
) -> SyncStats:
    """
    High-level sync function.
    
    Args:
        notion_api_key: Notion integration token
        notion_database_id: Target database ID
        roadmap_file_path: Path to roadmap.json
        config: Property mapping configuration (uses defaults if None)
        dry_run: If True, don't actually make changes
        skip_validation: If True, skip schema validation
    """
    if not notion_api_key:
        raise ValueError("NOTION_API_KEY is required")
    if not notion_database_id:
        raise ValueError("NOTION_DATABASE_ID is required")

    # Use default config if none provided
    if config is None:
        config = {"property_mapping": DEFAULT_PROPERTY_MAPPING.copy()}

    client = Client(auth=notion_api_key)
    mapping = config.get("property_mapping", DEFAULT_PROPERTY_MAPPING)
    id_property_name = mapping.get("id", "ID")

    # Fetch and validate schema
    logger.info("Fetching database schema from Notion...")
    schema = get_database_schema(client, notion_database_id)
    logger.info("Found %d properties in database", len(schema))
    
    # Auto-detect title property and warn if config is wrong
    title_prop = find_title_property(schema)
    config_title = mapping.get("title", "Task Name")
    if title_prop and config_title != title_prop:
        logger.warning(
            "Config maps 'title' to '%s', but database title property is '%s'. "
            "Updating mapping to use '%s'.",
            config_title, title_prop, title_prop
        )
        mapping["title"] = title_prop
    
    # Validate schema
    if not skip_validation:
        logger.info("Validating schema compatibility...")
        errors = validate_schema(schema, config)
        if errors:
            logger.error("=" * 60)
            logger.error("SCHEMA VALIDATION FAILED")
            logger.error("=" * 60)
            for error in errors:
                logger.error("  - %s", error)
            logger.error("")
            logger.error("Run with --schema to see your database structure.")
            logger.error("Edit scripts/notion_config.json to fix property mappings.")
            logger.error("=" * 60)
            raise SchemaValidationError(f"Schema validation failed: {len(errors)} error(s)")
        logger.info("Schema validation passed!")

    # Load roadmap
    logger.info("Loading local roadmap from %s", roadmap_file_path)
    roadmap_data = load_local_roadmap(roadmap_file_path)
    tasks = flatten_roadmap(roadmap_data)
    logger.info("Loaded %d tasks from roadmap", len(tasks))

    # Fetch existing pages
    logger.info("Fetching existing pages from Notion...")
    existing_pages = get_existing_pages(client, notion_database_id, id_property_name)
    logger.info("Found %d existing tasks in Notion", len(existing_pages))

    stats = SyncStats()

    for task in tasks:
        properties = format_notion_properties(task, config, schema)
        page = existing_pages.get(task.id)

        # Existing page -> update if needed
        if page:
            if needs_update(page, properties, config):
                try:
                    update_notion_page(
                        client,
                        page_id=page["id"],
                        properties=properties,
                        config=config,
                        dry_run=dry_run,
                    )
                    stats.updated += 1
                except APIResponseError:
                    stats.failed += 1
            else:
                logger.info("SKIP (no changes): %s", task.id)
                stats.skipped += 1
        else:
            try:
                create_notion_page(
                    client,
                    database_id=notion_database_id,
                    properties=properties,
                    config=config,
                    dry_run=dry_run,
                )
                stats.created += 1
            except APIResponseError:
                stats.failed += 1

    return stats


def main_from_env_and_args(argv: Optional[List[str]] = None) -> int:
    """
    Entry helper for CLI: reads env vars and arguments, runs sync, and
    returns a process exit code.
    """
    import argparse

    # Load from .env if present
    try:
        from dotenv import load_dotenv

        load_dotenv()
    except Exception:
        # It's okay if python-dotenv is not installed; env vars may still be set.
        pass

    parser = argparse.ArgumentParser(
        description="Sync roadmap.json tasks into a Notion database.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Inspect your database schema first
  python sync_notion.py --schema
  
  # Preview changes without syncing
  python sync_notion.py --dry-run --verbose
  
  # Sync with custom config
  python sync_notion.py --config my_config.json
  
  # Sync and skip validation (use with caution)
  python sync_notion.py --skip-validation
"""
    )
    parser.add_argument(
        "--database-id",
        dest="database_id",
        help="Notion database ID (defaults to NOTION_DATABASE_ID env var).",
    )
    parser.add_argument(
        "--roadmap",
        dest="roadmap_file",
        default=os.environ.get("ROADMAP_FILE_PATH", "roadmap.json"),
        help="Path to roadmap JSON (defaults to ROADMAP_FILE_PATH env var or roadmap.json).",
    )
    parser.add_argument(
        "--config",
        dest="config_file",
        help="Path to notion_config.json for property mapping (optional).",
    )
    parser.add_argument(
        "--schema",
        dest="show_schema",
        action="store_true",
        help="Print the Notion database schema and exit (useful for debugging).",
    )
    parser.add_argument(
        "--skip-validation",
        dest="skip_validation",
        action="store_true",
        help="Skip schema validation before syncing (use with caution).",
    )
    parser.add_argument(
        "--dry-run",
        dest="dry_run",
        action="store_true",
        help="Print planned changes without making any Notion API calls.",
    )
    parser.add_argument(
        "--verbose",
        dest="verbose",
        action="store_true",
        help="Enable debug logging.",
    )

    args = parser.parse_args(argv)

    # Configure logging
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)s %(message)s",
    )

    notion_api_key = os.environ.get("NOTION_API_KEY")
    if not notion_api_key:
        logger.error("NOTION_API_KEY environment variable not set.")
        return 1

    notion_database_id = args.database_id or os.environ.get("NOTION_DATABASE_ID")
    if not notion_database_id:
        logger.error(
            "NOTION_DATABASE_ID is not provided. "
            "Set the NOTION_DATABASE_ID environment variable or pass --database-id."
        )
        return 1
    
    # Format database ID with dashes if needed
    if len(notion_database_id) == 32 and "-" not in notion_database_id:
        notion_database_id = (
            f"{notion_database_id[:8]}-{notion_database_id[8:12]}-"
            f"{notion_database_id[12:16]}-{notion_database_id[16:20]}-"
            f"{notion_database_id[20:]}"
        )

    # Load config
    config = load_config(args.config_file)
    
    # Handle --schema flag: just print schema and exit
    if args.show_schema:
        try:
            client = Client(auth=notion_api_key)
            schema = get_database_schema(client, notion_database_id)
            print_schema(schema)
            
            # Also show current config mapping
            logger.info("")
            logger.info("CURRENT PROPERTY MAPPING (from config)")
            logger.info("-" * 40)
            mapping = config.get("property_mapping", DEFAULT_PROPERTY_MAPPING)
            for field, notion_prop in mapping.items():
                in_schema = "OK" if notion_prop in schema else "MISSING!"
                logger.info("  %s -> %s [%s]", field, notion_prop, in_schema)
            
            # Run validation and show results
            logger.info("")
            errors = validate_schema(schema, config)
            if errors:
                logger.warning("VALIDATION ISSUES:")
                for error in errors:
                    logger.warning("  - %s", error)
            else:
                logger.info("Schema validation: PASSED")
            
            return 0
        except APIResponseError as e:
            logger.error("Failed to fetch schema: %s", e)
            return 1

    try:
        stats = sync_roadmap_to_notion(
            notion_api_key=notion_api_key,
            notion_database_id=notion_database_id,
            roadmap_file_path=args.roadmap_file,
            config=config,
            dry_run=bool(args.dry_run),
            skip_validation=bool(args.skip_validation),
        )
    except RoadmapLoadError as e:
        logger.error("Failed to load roadmap: %s", e)
        return 1
    except SchemaValidationError:
        # Error already logged in sync function
        return 1
    except Exception:
        logger.exception("Unexpected error during sync.")
        return 1

    summary = stats.as_dict()
    logger.info(
        "Sync complete. created=%d updated=%d skipped=%d failed=%d",
        summary["created"],
        summary["updated"],
        summary["skipped"],
        summary["failed"],
    )

    return 0 if summary["failed"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main_from_env_and_args())
