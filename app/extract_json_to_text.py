#!/usr/bin/env python3
"""
Extract text content from JSON file and save to text file.
"""
import json
import sys

def extract_text_from_json(json_file_path, output_file_path):
    """Extract all text content from JSON and write to text file."""
    try:
        # Load JSON file
        with open(json_file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        # Extract text content
        text_parts = []
        
        # Get contents from result
        result = data.get('result', {})
        contents = result.get('contents', [])
        
        for content in contents:
            # Extract markdown if available
            if 'markdown' in content:
                text_parts.append(content['markdown'])
            
            # Extract text from fields if available
            if 'fields' in content:
                for field_name, field_value in content['fields'].items():
                    if isinstance(field_value, str):
                        text_parts.append(f"\n[{field_name}]\n{field_value}\n")
                    elif isinstance(field_value, dict):
                        # Recursively extract text from nested dictionaries
                        text_parts.append(f"\n[{field_name}]\n{json.dumps(field_value, indent=2, ensure_ascii=False)}\n")
            
            # Extract text from paragraphs if available
            if 'paragraphs' in content:
                for para in content['paragraphs']:
                    if isinstance(para, dict):
                        para_text = para.get('text', para.get('content', ''))
                        if para_text:
                            text_parts.append(para_text + '\n')
                    elif isinstance(para, str):
                        text_parts.append(para + '\n')
            
            # Extract text from sections if available
            if 'sections' in content:
                for section in content['sections']:
                    if isinstance(section, dict):
                        section_text = section.get('text', section.get('content', section.get('title', '')))
                        if section_text:
                            text_parts.append(section_text + '\n')
        
        # Combine all text parts
        full_text = '\n'.join(text_parts)
        
        # Write to output file
        with open(output_file_path, 'w', encoding='utf-8') as f:
            f.write(full_text)
        
        print(f"Successfully extracted text from '{json_file_path}'")
        print(f"Output saved to '{output_file_path}'")
        print(f"Total characters extracted: {len(full_text):,}")
        
        return True
        
    except Exception as e:
        print(f"Error processing JSON file: {e}", file=sys.stderr)
        return False

if __name__ == '__main__':
    json_file = 'science G-10 P-I E.pdf_latest.json'
    output_file = 'science G-10 P-I E.pdf_latest.txt'
    
    extract_text_from_json(json_file, output_file)


