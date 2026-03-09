// src/interfaces/SchemaInterface.ts

export interface Schema {
    id: number;
    user_id: number;
    team_id: number | null;
    name: string;
    description: string | null;
    prompt_text: string;
    created_at: Date;
    updated_at: Date | null;
    current_version_id: number | null;
  }
  
  export interface SchemaVersion {
    id: number;
    schema_id: number;
    version_number: number;
    schema_json: string; // The actual diagram data as a JSON string
    notes: string | null;
    created_at: Date;
    created_by_user_id: number;
  }
  
  // Interface for the incoming request body when saving a NEW schema
  export interface NewSchemaPayload {
    name: string;
    description?: string;
    prompt_text: string;
    schema_json: string; // This is the new required field
    team_id?: number;
  }
  
  // Interface for fetching schemas including their current version's JSON
  export interface FetchedSchema extends Schema {
    current_schema_json?: string; // Optional, if you join to get it directly
  }