#!/usr/bin/env python3
"""
Script to run GraphRAG queries programmatically.

This script replicates the functionality of the graphrag query CLI command
but allows you to run queries from Python code.

Available Search Methods:
-------------------------
1. **Global Search** (`run_global_query`):
   - Searches across community reports to find high-level themes and patterns
   - Best for: "What are the top themes?", "What are the main topics?"
   - Requires: entities, communities, community_reports
   - Supports: dynamic_community_selection, community_level

2. **Local Search** (`run_local_query`):
   - Searches for specific entities and their relationships
   - Best for: "Who is X?", "What are the relationships between X and Y?"
   - Requires: entities, communities, community_reports, text_units, relationships
   - Supports: community_level

3. **Drift Search** (`run_drift_query`):
   - Uses a state machine to dynamically explore the knowledge graph
   - Best for: Complex queries requiring multi-step reasoning
   - Requires: entities, communities, community_reports, text_units, relationships, community_level (required)
   - Note: community_level must be specified

4. **Basic Search** (`run_basic_query`):
   - Simple semantic search over text units without graph structure
   - Best for: Simple queries that don't need graph traversal
   - Requires: text_units only
   - Fastest but least sophisticated

Convenience Function:
---------------------
- `run_query()`: Routes to the appropriate search function based on method parameter
  Usage: run_query(root_dir="./christmas", query="...", method="global")
"""

import asyncio
import logging
from pathlib import Path
from typing import Any

from graphrag.api.query import (
    basic_search,
    drift_search,
    global_search,
    local_search,
)
from graphrag.config.load_config import load_config
from graphrag.utils.storage import load_table_from_storage, storage_has_table
from graphrag_storage import create_storage

logger = logging.getLogger(__name__)


async def load_data_files(
    config, output_list: list[str], optional_list: list[str] | None = None
) -> dict[str, Any]:
    """Load data files from the GraphRAG output directory.
    
    Parameters
    ----------
    config
        GraphRAG configuration object
    output_list : list[str]
        List of required output file names (without .parquet extension)
    optional_list : list[str] | None
        List of optional output file names (without .parquet extension)
    
    Returns
    -------
    dict[str, Any]
        Dictionary mapping file names to pandas DataFrames (or None if not found)
    """
    dataframe_dict = {}
    storage_obj = create_storage(config.output_storage)
    
    # Load required files
    for name in output_list:
        file_exists = await storage_has_table(name, storage_obj)
        if file_exists:
            df_value = await load_table_from_storage(name=name, storage=storage_obj)
            dataframe_dict[name] = df_value
        else:
            logger.warning(
                f"File {name}.parquet not found in storage. "
                "Indexing may not have completed."
            )
            dataframe_dict[name] = None
    
    # Handle optional files
    if optional_list:
        for optional_file in optional_list:
            file_exists = await storage_has_table(optional_file, storage_obj)
            if file_exists:
                df_value = await load_table_from_storage(
                    name=optional_file, storage=storage_obj
                )
                dataframe_dict[optional_file] = df_value
            else:
                dataframe_dict[optional_file] = None
    
    return dataframe_dict


async def run_global_query(
    root_dir: str | Path,
    query: str,
    community_level: int | None = None,
    dynamic_community_selection: bool = False,
    response_type: str = "text",
    config_filepath: Path | None = None,
    data_dir: Path | None = None,
    verbose: bool = False,
) -> tuple[Any, dict[str, Any]]:
    """
    Run a global search query.
    
    Parameters
    ----------
    root_dir : str | Path
        Root directory containing the GraphRAG project (should contain settings.yaml)
    query : str
        The query string to search for
    community_level : int | None
        The community level to search at
    dynamic_community_selection : bool
        Enable dynamic community selection
    response_type : str
        The type of response to return (default: "text")
    config_filepath : Path | None
        Optional path to a custom config file
    data_dir : Path | None
        Optional path to override the output directory
    verbose : bool
        Enable verbose logging
    
    Returns
    -------
    tuple[Any, dict[str, Any]]
        The response and context data
    """
    root = Path(root_dir).resolve()
    cli_overrides: dict[str, Any] = {}
    if data_dir:
        cli_overrides["output_storage"] = {"base_dir": str(data_dir)}
    
    config = load_config(root_dir=root, cli_overrides=cli_overrides if cli_overrides else None)
    
    # Load required data files
    dataframe_dict = await load_data_files(
        config=config,
        output_list=["entities", "communities", "community_reports"],
        optional_list=[],
    )
    
    final_entities = dataframe_dict["entities"]
    final_communities = dataframe_dict["communities"]
    final_community_reports = dataframe_dict["community_reports"]
    
    response, context_data = await global_search(
        config=config,
        entities=final_entities,
        communities=final_communities,
        community_reports=final_community_reports,
        community_level=community_level,
        dynamic_community_selection=dynamic_community_selection,
        response_type=response_type,
        query=query,
        verbose=verbose,
    )
    
    return response, context_data


async def run_local_query(
    root_dir: str | Path,
    query: str,
    community_level: int | None = None,
    response_type: str = "text",
    config_filepath: Path | None = None,
    data_dir: Path | None = None,
    verbose: bool = False,
) -> tuple[Any, dict[str, Any]]:
    """
    Run a local search query.
    
    Parameters
    ----------
    root_dir : str | Path
        Root directory containing the GraphRAG project (should contain settings.yaml)
    query : str
        The query string to search for
    community_level : int | None
        The community level to search at
    response_type : str
        The type of response to return (default: "text")
    config_filepath : Path | None
        Optional path to a custom config file
    data_dir : Path | None
        Optional path to override the output directory
    verbose : bool
        Enable verbose logging
    
    Returns
    -------
    tuple[Any, dict[str, Any]]
        The response and context data
    """
    root = Path(root_dir).resolve()
    cli_overrides: dict[str, Any] = {}
    if data_dir:
        cli_overrides["output_storage"] = {"base_dir": str(data_dir)}
    
    config = load_config(root_dir=root, cli_overrides=cli_overrides if cli_overrides else None)
    
    # Default community_level to 0 if not provided (required by API)
    if community_level is None:
        community_level = 0
    
    # Load required data files
    dataframe_dict = await load_data_files(
        config=config,
        output_list=[
            "communities",
            "community_reports",
            "text_units",
            "relationships",
            "entities",
        ],
        optional_list=["covariates"],
    )
    
    final_entities = dataframe_dict["entities"]
    final_communities = dataframe_dict["communities"]
    final_community_reports = dataframe_dict["community_reports"]
    final_text_units = dataframe_dict["text_units"]
    final_relationships = dataframe_dict["relationships"]
    final_covariates = dataframe_dict.get("covariates")
    
    response, context_data = await local_search(
        config=config,
        entities=final_entities,
        communities=final_communities,
        community_reports=final_community_reports,
        text_units=final_text_units,
        relationships=final_relationships,
        covariates=final_covariates,
        community_level=community_level,
        response_type=response_type,
        query=query,
        verbose=verbose,
    )
    
    return response, context_data


async def run_drift_query(
    root_dir: str | Path,
    query: str,
    community_level: int,
    response_type: str = "text",
    config_filepath: Path | None = None,
    data_dir: Path | None = None,
    verbose: bool = False,
) -> tuple[Any, dict[str, Any]]:
    """
    Run a drift search query.
    
    DRIFT search is a structured search method that uses a state machine to
    explore the knowledge graph dynamically.
    
    Parameters
    ----------
    root_dir : str | Path
        Root directory containing the GraphRAG project (should contain settings.yaml)
    query : str
        The query string to search for
    community_level : int
        The community level to search at (required for drift search)
    response_type : str
        The type of response to return (default: "text")
    config_filepath : Path | None
        Optional path to a custom config file
    data_dir : Path | None
        Optional path to override the output directory
    verbose : bool
        Enable verbose logging
    
    Returns
    -------
    tuple[Any, dict[str, Any]]
        The response and context data
    """
    root = Path(root_dir).resolve()
    cli_overrides: dict[str, Any] = {}
    if data_dir:
        cli_overrides["output_storage"] = {"base_dir": str(data_dir)}
    
    config = load_config(root_dir=root, cli_overrides=cli_overrides if cli_overrides else None)
    
    # Load required data files
    dataframe_dict = await load_data_files(
        config=config,
        output_list=[
            "communities",
            "community_reports",
            "text_units",
            "relationships",
            "entities",
        ],
        optional_list=[],
    )
    
    final_entities = dataframe_dict["entities"]
    final_communities = dataframe_dict["communities"]
    final_community_reports = dataframe_dict["community_reports"]
    final_text_units = dataframe_dict["text_units"]
    final_relationships = dataframe_dict["relationships"]
    
    response, context_data = await drift_search(
        config=config,
        entities=final_entities,
        communities=final_communities,
        community_reports=final_community_reports,
        text_units=final_text_units,
        relationships=final_relationships,
        community_level=community_level,
        response_type=response_type,
        query=query,
        verbose=verbose,
    )
    
    return response, context_data


async def run_basic_query(
    root_dir: str | Path,
    query: str,
    response_type: str = "text",
    config_filepath: Path | None = None,
    data_dir: Path | None = None,
    verbose: bool = False,
    s3_key: str | None = None,
) -> tuple[Any, dict[str, Any]]:
    """
    Run a basic search query.
    
    Basic search is a simple semantic search over text units without using
    the knowledge graph structure.
    
    Parameters
    ----------
    root_dir : str | Path
        Root directory containing the GraphRAG project (should contain settings.yaml)
    query : str
        The query string to search for
    response_type : str
        The type of response to return (default: "text")
    config_filepath : Path | None
        Optional path to a custom config file
    data_dir : Path | None
        Optional path to override the output directory
    verbose : bool
        Enable verbose logging
    
    Returns
    -------
    tuple[Any, dict[str, Any]]
        The response and context data
    """
    root = Path(root_dir).resolve()
    cli_overrides: dict[str, Any] = {}
    if data_dir:
        cli_overrides["output_storage"] = {"base_dir": str(data_dir)}
    
    config = load_config(root_dir=root, cli_overrides=cli_overrides if cli_overrides else None)
    
    # Load required data files (only text_units needed for basic search)
    dataframe_dict = await load_data_files(
        config=config,
        output_list=["text_units"],
        optional_list=[],
    )
    
    final_text_units = dataframe_dict["text_units"]
    
    # Check if text_units was loaded successfully
    if final_text_units is None:
        raise ValueError(
            "text_units.parquet not found in storage. "
            "GraphRAG indexing may not have completed successfully. "
            "Please run 'graphrag index' first."
        )
    
    response, context_data = await basic_search(
        config=config,
        text_units=final_text_units,
        response_type=response_type,
        query=query,
        verbose=verbose,
    )
    
    return response, context_data


async def run_query(
    root_dir: str | Path,
    query: str,
    method: str = "local",
    community_level: int | None = None,
    dynamic_community_selection: bool = False,
    response_type: str = "text",
    config_filepath: Path | None = None,
    data_dir: Path | None = None,
    verbose: bool = False,
    s3_key: str | None = None,
) -> tuple[Any, dict[str, Any]]:
    """
    Run a query using the specified search method.
    
    This is a convenience function that routes to the appropriate search function
    based on the method parameter.
    
    Parameters
    ----------
    root_dir : str | Path
        Root directory containing the GraphRAG project (should contain settings.yaml)
    query : str
        The query string to search for
    method : str
        The search method to use. Options: "global", "local", "drift", "basic" (default: "local")
    community_level : int | None
        The community level to search at (required for drift search, optional for others)
    dynamic_community_selection : bool
        Enable dynamic community selection (only for global search)
    response_type : str
        The type of response to return (default: "text")
    config_filepath : Path | None
        Optional path to a custom config file
    data_dir : Path | None
        Optional path to override the output directory
    verbose : bool
        Enable verbose logging
    
    Returns
    -------
    tuple[Any, dict[str, Any]]
        The response and context data
    
    Raises
    ------
    ValueError
        If an invalid method is specified or if community_level is not provided for drift search
    """
    method = method.lower()
    
    if method == "global":
        return await run_global_query(
            root_dir=root_dir,
            query=query,
            community_level=community_level,
            dynamic_community_selection=dynamic_community_selection,
            response_type=response_type,
            config_filepath=config_filepath,
            data_dir=data_dir,
            verbose=verbose,
        )
    elif method == "local":
        return await run_local_query(
            root_dir=root_dir,
            query=query,
            community_level=community_level,
            response_type=response_type,
            config_filepath=config_filepath,
            data_dir=data_dir,
            verbose=verbose,
        )
    elif method == "drift":
        if community_level is None:
            raise ValueError("community_level is required for drift search")
        return await run_drift_query(
            root_dir=root_dir,
            query=query,
            community_level=community_level,
            response_type=response_type,
            config_filepath=config_filepath,
            data_dir=data_dir,
            verbose=verbose,
        )
    elif method == "basic":
        return await run_basic_query(
            root_dir=root_dir,
            query=query,
            response_type=response_type,
            config_filepath=config_filepath,
            data_dir=data_dir,
            verbose=verbose,
            s3_key=s3_key,
        )
    else:
        raise ValueError(
            f"Invalid method '{method}'. Must be one of: 'global', 'local', 'drift', 'basic'"
        )


def main():
    """Example usage of the query functions."""
    # Example 1: Global search query
    print("=" * 80)
    print("Running Global Search Query")
    print("=" * 80)
    print("Query: What are the top themes in this story?")
    print()
    
    response, context_data = asyncio.run(
        run_global_query(
            root_dir="./christmas",
            query="What are the top themes in this story?",
        )
    )
    
    print("Response:")
    print(response)
    print()
    print("=" * 80)
    
    # Example 2: Local search query
    print("=" * 80)
    print("Running Local Search Query")
    print("=" * 80)
    print("Query: Who is Scrooge and what are his main relationships?")
    print()
    
    response, context_data = asyncio.run(
        run_local_query(
            root_dir="./christmas",
            query="Who is Scrooge and what are his main relationships?",
        )
    )
    
    print("Response:")
    print(response)
    print()
    print("=" * 80)
    
    # Example 3: Drift search query
    print("=" * 80)
    print("Running Drift Search Query")
    print("=" * 80)
    print("Query: What are the main themes and how do they relate to each other?")
    print()
    
    response, context_data = asyncio.run(
        run_drift_query(
            root_dir="./christmas",
            query="What are the main themes and how do they relate to each other?",
            community_level=0,  # Required for drift search
        )
    )
    
    print("Response:")
    print(response)
    print()
    print("=" * 80)
    
    # Example 4: Basic search query
    print("=" * 80)
    print("Running Basic Search Query")
    print("=" * 80)
    print("Query: What is the story about?")
    print()
    
    response, context_data = asyncio.run(
        run_basic_query(
            root_dir="./christmas",
            query="What is the story about?",
        )
    )
    
    print("Response:")
    print(response)
    print()
    print("=" * 80)


if __name__ == "__main__":
    main()

