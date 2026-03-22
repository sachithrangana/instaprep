#!/usr/bin/env python3
"""
Simple example script showing how to run GraphRAG queries using Python.

This script demonstrates how to run queries using all available search methods:
1. Global search: "What are the top themes in this story?"
2. Local search: "Who is Scrooge and what are his main relationships?"
3. Drift search: "What are the main themes and how do they relate to each other?"
4. Basic search: "What is the story about?"
"""

import asyncio
from run_queries import (
    run_global_query,
    run_local_query,
    run_drift_query,
    run_basic_query,
    run_query,  # Convenience function
)


async def main():
    """Run the example queries."""
    
    # Query 1: Global search
    # print("=" * 80)
    # print("QUERY 1: What are the top chapters in this book?)")
    # print("=" * 80)
    # print("Query: What are the top chapters in this book?")
    # print()
    
    # response1, context_data1 = await run_query(
    #     root_dir="./sciencetextbook",
    #     query="What are the top chapters in this book?",
    #     method="global",
    #     community_level=0,  # Required for drift search
    # )
    
    # print("Response:")
    # print(response1)
    # print()
    # print("=" * 80)
    # print()

    # print("=" * 80)
    # print("QUERY 2: What are the top chapters in this book?)")
    # print("=" * 80)
    # print("Query: What are the top chapters in this book?")
    # print()
    
    # response2, context_data2 = await run_query(
    #     root_dir="./sciencetextbook",
    #     query="What are the top chapters in this book?",
    #     method="local",
    #     community_level=0,  # Required for drift search
    # )

    # print("Response:")
    # print(response2)
    # print()
    # print("=" * 80)
    # print()
    
    # Query 3: Drift search (using convenience function)
    # print("=" * 80)
    # print("QUERY 3: What are the top chapters in this book?)")
    # print("=" * 80)
    # print("Query: What are the top chapters in this book?")
    # print()
    
    # response3, context_data3 = await run_query(
    #     root_dir="./sciencetextbook",
    #     query="What are the top chapters in this book?",
    #     method="drift",
    #     community_level=0,  # Required for drift search
    # )
    
    # print("Response:")
    # print(response3)
    # print()
    # print("=" * 80)
    # print()
    
    # Query 4: Basic search
    print("=" * 80)
    print("QUERY 4: What are the top chapters in this book?)")
    print("=" * 80)
    print("Query: What are the top chapters in this book?")
    print()
    
    response4, context_data4 = await run_query(
        root_dir="./sciencetextbook",
        query="What are the top chapters in this book?",
        method="local",
        community_level=3,
    )

    print("Response:")
    print(response4)
    print()
    print("=" * 80)
    print()

if __name__ == "__main__":
    asyncio.run(main())

