export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GOOGLE_SERVICE_ACCOUNT_EMAIL: string;
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: string;
  GOOGLE_WORKSPACE_ADMIN_EMAIL: string;
  ADMIN_GROUP_EMAIL: string;
  ENGINEER_GROUP_EMAIL: string;
  GOOGLE_DRIVE_API_KEY: string;
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  GOOGLE_GENERATIVE_AI_API_KEY?: string;
  LLM_API_KEY?: string;
  SESSION_SECRET: string;
  PUBLIC_ORIGIN: string;
}

export interface SessionUser {
  sub: string;
  email: string;
  name: string;
  picture?: string;
}

export interface RoleState extends SessionUser {
  isAdmin: boolean;
  isEngineer: boolean;
  canCreate: boolean;
}

export interface ProjectRow {
  id: string;
  owner_sub: string;
  owner_email: string;
  title: string;
  current_revision_id: string | null;
  shared_revision_id: string | null;
  share_salt: string | null;
  share_hash: string | null;
  created_at: string;
  updated_at: string;
}

export interface RevisionRow {
  id: string;
  project_id: string;
  source_key: string;
  origin: 'initial' | 'manual' | 'ai' | 'restore';
  note: string | null;
  created_at: string;
}
