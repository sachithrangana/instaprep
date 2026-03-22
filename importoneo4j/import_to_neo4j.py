#!/usr/bin/env python3
"""
Import GraphRAG knowledge graph output into Neo4j.

This script reads entities and relationships from GraphRAG parquet files
and imports them into a Neo4j graph database.
"""

import os
import sys
import pandas as pd
from neo4j import GraphDatabase
from typing import Optional
import argparse
from pathlib import Path


class Neo4jGraphImporter:
    """Import GraphRAG output into Neo4j."""
    
    def __init__(self, uri: str, username: str, password: str, database: str = "neo4j"):
        """Initialize Neo4j connection."""
        self.driver = GraphDatabase.driver(uri, auth=(username, password))
        self.database = database
        self.uri = uri
        self.username = username
        
    def close(self):
        """Close the Neo4j driver connection."""
        self.driver.close()
    
    def clear_database(self, confirm: bool = False):
        """Clear all nodes and relationships from the database."""
        if not confirm:
            print("Warning: This will delete all data in Neo4j!")
            response = input("Type 'yes' to confirm: ")
            if response.lower() != 'yes':
                print("Aborted.")
                return
        
        with self.driver.session(database=self.database) as session:
            result = session.run("MATCH (n) DETACH DELETE n RETURN count(n) as deleted")
            count = result.single()["deleted"]
            print(f"Deleted {count} nodes and relationships.")
    
    def import_entities(self, entities_df: pd.DataFrame, batch_size: int = 1000):
        """Import entities as nodes in Neo4j."""
        print(f"Importing {len(entities_df)} entities...")
        
        with self.driver.session(database=self.database) as session:
            # Process in batches
            for i in range(0, len(entities_df), batch_size):
                batch = entities_df.iloc[i:i+batch_size]
                
                query = """
                UNWIND $entities AS entity
                MERGE (e:Entity {id: entity.id})
                SET e.title = entity.title,
                    e.type = entity.type,
                    e.description = entity.description,
                    e.frequency = entity.frequency,
                    e.degree = entity.degree,
                    e.human_readable_id = entity.human_readable_id
                """
                
                # Handle optional x, y coordinates
                if 'x' in batch.columns and 'y' in batch.columns:
                    query += ", e.x = entity.x, e.y = entity.y"
                
                entities_list = batch.to_dict('records')
                
                # Convert numpy arrays to lists for JSON serialization
                for entity in entities_list:
                    if 'text_unit_ids' in entity and hasattr(entity['text_unit_ids'], 'tolist'):
                        entity['text_unit_ids'] = entity['text_unit_ids'].tolist()
                
                session.run(query, entities=entities_list)
                
                print(f"  Imported batch {i//batch_size + 1} ({min(i+batch_size, len(entities_df))}/{len(entities_df)} entities)")
        
        print(f"✓ Successfully imported {len(entities_df)} entities")
    
    def import_relationships(self, relationships_df: pd.DataFrame, batch_size: int = 1000):
        """Import relationships as edges in Neo4j."""
        print(f"Importing {len(relationships_df)} relationships...")
        
        with self.driver.session(database=self.database) as session:
            # Process in batches
            for i in range(0, len(relationships_df), batch_size):
                batch = relationships_df.iloc[i:i+batch_size]
                
                query = """
                UNWIND $relationships AS rel
                MATCH (source:Entity {title: rel.source})
                MATCH (target:Entity {title: rel.target})
                MERGE (source)-[r:RELATES_TO {id: rel.id}]->(target)
                SET r.description = rel.description,
                    r.weight = rel.weight,
                    r.combined_degree = rel.combined_degree,
                    r.human_readable_id = rel.human_readable_id
                """
                
                relationships_list = batch.to_dict('records')
                
                # Convert numpy arrays to lists
                for rel in relationships_list:
                    if 'text_unit_ids' in rel and hasattr(rel['text_unit_ids'], 'tolist'):
                        rel['text_unit_ids'] = rel['text_unit_ids'].tolist()
                
                session.run(query, relationships=relationships_list)
                
                print(f"  Imported batch {i//batch_size + 1} ({min(i+batch_size, len(relationships_df))}/{len(relationships_df)} relationships)")
        
        print(f"✓ Successfully imported {len(relationships_df)} relationships")
    
    def create_indexes(self):
        """Create indexes for better query performance."""
        print("Creating indexes...")
        
        with self.driver.session(database=self.database) as session:
            # Index on entity ID (unique identifier)
            session.run("CREATE INDEX entity_id IF NOT EXISTS FOR (e:Entity) ON (e.id)")
            
            # Index on entity title (used for relationship matching)
            session.run("CREATE INDEX entity_title IF NOT EXISTS FOR (e:Entity) ON (e.title)")
            
            # Index on entity type
            session.run("CREATE INDEX entity_type IF NOT EXISTS FOR (e:Entity) ON (e.type)")
            
            # Index on relationship ID
            session.run("CREATE INDEX rel_id IF NOT EXISTS FOR ()-[r:RELATES_TO]-() ON (r.id)")
        
        print("✓ Indexes created")
    
    def import_graph(self, entities_path: str, relationships_path: str, 
                     clear_first: bool = False, create_indexes: bool = True):
        """Import complete graph from GraphRAG output files."""
        print(f"\n{'='*60}")
        print("GraphRAG to Neo4j Import")
        print(f"{'='*60}\n")
        
        # Load data
        print("Loading data files...")
        entities_df = pd.read_parquet(entities_path)
        relationships_df = pd.read_parquet(relationships_path)
        print(f"  Loaded {len(entities_df)} entities")
        print(f"  Loaded {len(relationships_df)} relationships\n")
        
        # Clear database if requested
        if clear_first:
            self.clear_database(confirm=True)
            print()
        
        # Import entities
        self.import_entities(entities_df)
        print()
        
        # Import relationships
        self.import_relationships(relationships_df)
        print()
        
        # Create indexes
        if create_indexes:
            self.create_indexes()
            print()
        
        # Print summary
        with self.driver.session(database=self.database) as session:
            node_count = session.run("MATCH (n:Entity) RETURN count(n) as count").single()["count"]
            rel_count = session.run("MATCH ()-[r:RELATES_TO]->() RETURN count(r) as count").single()["count"]
            
            print(f"{'='*60}")
            print("Import Summary")
            print(f"{'='*60}")
            print(f"Neo4j URI: {self.uri}")
            print(f"Database: {self.database}")
            print(f"Nodes: {node_count}")
            print(f"Relationships: {rel_count}")
            print(f"{'='*60}\n")
            
            # Print entity type distribution
            print("Entity Types:")
            result = session.run("""
                MATCH (e:Entity)
                RETURN e.type as type, count(e) as count
                ORDER BY count DESC
            """)
            for record in result:
                print(f"  {record['type']}: {record['count']}")


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Import GraphRAG output into Neo4j",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Import with environment variables
  export NEO4J_URI="bolt://localhost:7687"
  export NEO4J_USERNAME="neo4j"
  export NEO4J_PASSWORD="password"
  python import_to_neo4j.py --entities output/entities.parquet --relationships output/relationships.parquet
  
  # Import with command-line arguments
  python import_to_neo4j.py \\
    --uri bolt://localhost:7687 \\
    --username neo4j \\
    --password password \\
    --entities output/entities.parquet \\
    --relationships output/relationships.parquet \\
    --clear
        """
    )
    
    parser.add_argument(
        "--uri",
        default=os.getenv("NEO4J_URI", "bolt://localhost:7687"),
        help="Neo4j connection URI (default: bolt://localhost:7687)"
    )
    parser.add_argument(
        "--username",
        default=os.getenv("NEO4J_USERNAME", "neo4j"),
        help="Neo4j username (default: neo4j)"
    )
    parser.add_argument(
        "--password",
        default=os.getenv("NEO4J_PASSWORD", ""),
        help="Neo4j password (or set NEO4J_PASSWORD env var)"
    )
    parser.add_argument(
        "--database",
        default=os.getenv("NEO4J_DATABASE", "neo4j"),
        help="Neo4j database name (default: neo4j)"
    )
    parser.add_argument(
        "--entities",
        required=True,
        help="Path to entities.parquet file"
    )
    parser.add_argument(
        "--relationships",
        required=True,
        help="Path to relationships.parquet file"
    )
    parser.add_argument(
        "--clear",
        action="store_true",
        help="Clear existing data before import"
    )
    parser.add_argument(
        "--no-indexes",
        action="store_true",
        help="Skip creating indexes"
    )
    
    args = parser.parse_args()
    
    # Validate files exist
    if not os.path.exists(args.entities):
        print(f"Error: Entities file not found: {args.entities}")
        sys.exit(1)
    
    if not os.path.exists(args.relationships):
        print(f"Error: Relationships file not found: {args.relationships}")
        sys.exit(1)
    
    # Check password
    if not args.password:
        print("Error: Neo4j password is required. Set NEO4J_PASSWORD env var or use --password")
        sys.exit(1)
    
    # Import
    try:
        importer = Neo4jGraphImporter(
            uri=args.uri,
            username=args.username,
            password=args.password,
            database=args.database
        )
        
        importer.import_graph(
            entities_path=args.entities,
            relationships_path=args.relationships,
            clear_first=args.clear,
            create_indexes=not args.no_indexes
        )
        
        importer.close()
        print("✓ Import completed successfully!")
        
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()

