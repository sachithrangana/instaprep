#!/usr/bin/env python3
"""
Example workflow: GraphRAG Indexing + Neo4j Import

This script demonstrates how to run GraphRAG indexing and automatically
sync the results to Neo4j.
"""

import os
import sys
from pathlib import Path

# Add current directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from neo4j_integration import sync_graphrag_to_neo4j


def main():
    """Run GraphRAG indexing and sync to Neo4j."""
    
    # Configuration
    config_path = "sciencetextbook/settings.yaml"
    entities_path = "sciencetextbook/output/entities.parquet"
    relationships_path = "sciencetextbook/output/relationships.parquet"
    
    print("=" * 60)
    print("GraphRAG + Neo4j Integration Workflow")
    print("=" * 60)
    print()
    
    # Step 1: Run GraphRAG indexing (if not already done)
    print("Step 1: Check if GraphRAG output exists...")
    if not os.path.exists(entities_path) or not os.path.exists(relationships_path):
        print("  GraphRAG output not found. Please run indexing first:")
        print(f"  graphrag index --config {config_path}")
        print()
        print("  Then run this script again to import to Neo4j.")
        return
    else:
        print("  ✓ GraphRAG output files found")
    print()
    
    # Step 2: Sync to Neo4j
    print("Step 2: Importing to Neo4j...")
    try:
        sync_graphrag_to_neo4j(
            entities_path=entities_path,
            relationships_path=relationships_path,
            clear_first=False  # Set to True to clear database first
        )
        print()
        print("=" * 60)
        print("✓ Workflow completed successfully!")
        print("=" * 60)
        print()
        print("Next steps:")
        print("  1. Open Neo4j Browser: http://localhost:7474")
        print("  2. Run queries to explore your knowledge graph")
        print("  3. Use Neo4j Bloom for visualization (Enterprise)")
        print()
        
    except Exception as e:
        print(f"Error importing to Neo4j: {e}")
        print()
        print("Make sure:")
        print("  1. Neo4j is running")
        print("  2. NEO4J_PASSWORD environment variable is set")
        print("  3. Connection details are correct")
        sys.exit(1)


if __name__ == "__main__":
    main()

