#!/usr/bin/env python3
"""
Neo4j Integration for GraphRAG

This module provides integration between Microsoft GraphRAG and Neo4j,
allowing you to automatically sync GraphRAG output to Neo4j after indexing.
"""

import os
import yaml
from pathlib import Path
from import_to_neo4j import Neo4jGraphImporter


def load_config(config_path: str = "neo4j_config.yaml") -> dict:
    """Load Neo4j configuration from YAML file."""
    if not os.path.exists(config_path):
        raise FileNotFoundError(f"Configuration file not found: {config_path}")
    
    with open(config_path, 'r') as f:
        config = yaml.safe_load(f)
    
    return config


def sync_graphrag_to_neo4j(
    entities_path: str,
    relationships_path: str,
    config_path: str = "neo4j_config.yaml",
    clear_first: bool = False
):
    """
    Sync GraphRAG output to Neo4j using configuration file.
    
    Args:
        entities_path: Path to entities.parquet file
        relationships_path: Path to relationships.parquet file
        config_path: Path to Neo4j configuration file
        clear_first: Whether to clear database before import
    """
    # Load configuration
    config = load_config(config_path)
    neo4j_config = config.get('neo4j', {})
    import_config = neo4j_config.get('import', {})
    
    # Get connection details (prefer environment variables)
    uri = os.getenv("NEO4J_URI", neo4j_config.get('uri', "bolt://localhost:7687"))
    username = os.getenv("NEO4J_USERNAME", neo4j_config.get('username', "neo4j"))
    password = os.getenv("NEO4J_PASSWORD", neo4j_config.get('password', ""))
    database = os.getenv("NEO4J_DATABASE", neo4j_config.get('database', "neo4j"))
    
    if not password:
        raise ValueError("Neo4j password is required. Set NEO4J_PASSWORD environment variable.")
    
    # Create importer
    importer = Neo4jGraphImporter(uri, username, password, database)
    
    try:
        # Import graph
        importer.import_graph(
            entities_path=entities_path,
            relationships_path=relationships_path,
            clear_first=clear_first or import_config.get('clear_before_import', False),
            create_indexes=import_config.get('create_indexes', True)
        )
    finally:
        importer.close()


def sync_from_config(config_path: str = "neo4j_config.yaml", clear_first: bool = False):
    """
    Sync GraphRAG output to Neo4j using paths from configuration file.
    
    Args:
        config_path: Path to Neo4j configuration file
        clear_first: Whether to clear database before import
    """
    config = load_config(config_path)
    graphrag_output = config.get('graphrag_output', {})
    
    entities_path = graphrag_output.get('entities')
    relationships_path = graphrag_output.get('relationships')
    
    if not entities_path or not relationships_path:
        raise ValueError("graphrag_output.entities and graphrag_output.relationships must be set in config")
    
    # Resolve relative paths
    config_dir = Path(config_path).parent
    entities_path = str(config_dir / entities_path) if not os.path.isabs(entities_path) else entities_path
    relationships_path = str(config_dir / relationships_path) if not os.path.isabs(relationships_path) else relationships_path
    
    sync_graphrag_to_neo4j(entities_path, relationships_path, config_path, clear_first)


if __name__ == "__main__":
    import argparse
    import sys
    
    parser = argparse.ArgumentParser(description="Sync GraphRAG output to Neo4j")
    parser.add_argument(
        "--config",
        default="neo4j_config.yaml",
        help="Path to Neo4j configuration file"
    )
    parser.add_argument(
        "--clear",
        action="store_true",
        help="Clear database before import"
    )
    parser.add_argument(
        "--entities",
        help="Override entities path from config"
    )
    parser.add_argument(
        "--relationships",
        help="Override relationships path from config"
    )
    
    args = parser.parse_args()
    
    try:
        if args.entities and args.relationships:
            sync_graphrag_to_neo4j(
                args.entities,
                args.relationships,
                args.config,
                args.clear
            )
        else:
            sync_from_config(args.config, args.clear)
        
        print("\n✓ Sync completed successfully!")
        
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

