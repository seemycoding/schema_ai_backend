CREATE TABLE Users (

id SERIAL PRIMARY KEY NOT NULL,

email VARCHAR(255),

password_hash VARCHAR(255),

username VARCHAR(100) NOT NULL,

plan_id INTEGER NOT NULL,

created_at TIMESTAMP NOT NULL,

last_login_at TIMESTAMP

);



CREATE TABLE Plans (

id SERIAL PRIMARY KEY NOT NULL,

name VARCHAR(50) NOT NULL,

max_diagrams INTEGER NOT NULL,

has_collaboration BOOLEAN NOT NULL,

has_version_history BOOLEAN NOT NULL,

max_memory_messages INTEGER NOT NULL DEFAULT 20,

context_window_messages INTEGER NOT NULL DEFAULT 12,

max_collaborators_per_diagram INTEGER,

version_retention_days INTEGER,

price DECIMAL(10,2) NOT NULL,

description TEXT,

created_at TIMESTAMP NOT NULL,

updated_at TIMESTAMP

);



CREATE TABLE SocialLogins (

id SERIAL PRIMARY KEY NOT NULL,

user_id INTEGER NOT NULL,

provider VARCHAR(50) NOT NULL,

provider_id VARCHAR(255) NOT NULL,

created_at TIMESTAMP NOT NULL

);



CREATE TABLE Teams (

id SERIAL PRIMARY KEY NOT NULL,

name VARCHAR(255) NOT NULL,

owner_user_id INTEGER NOT NULL,

created_at TIMESTAMP NOT NULL

);



CREATE TABLE TeamMembers (

id SERIAL PRIMARY KEY NOT NULL,

team_id INTEGER NOT NULL,

user_id INTEGER NOT NULL,

role VARCHAR(50) NOT NULL,

joined_at TIMESTAMP NOT NULL

);



CREATE TABLE Schemas (

id SERIAL PRIMARY KEY NOT NULL,

user_id INTEGER NOT NULL,

team_id INTEGER,

name VARCHAR(255) NOT NULL,

description TEXT,

prompt_text TEXT NOT NULL,

created_at TIMESTAMP NOT NULL,

updated_at TIMESTAMP,

current_version_id INTEGER

);



CREATE TABLE SchemaVersions (

id SERIAL PRIMARY KEY NOT NULL,

schema_id INTEGER NOT NULL,

version_number INTEGER NOT NULL,

schema_json TEXT NOT NULL,

notes TEXT,

created_at TIMESTAMP NOT NULL,

created_by_user_id INTEGER NOT NULL

);



CREATE TABLE PromptHistory (

id SERIAL PRIMARY KEY NOT NULL,

user_id INTEGER NOT NULL,

prompt_text TEXT NOT NULL,

response_json TEXT NOT NULL,

created_at TIMESTAMP NOT NULL

);

CREATE TABLE SchemaShares (

id SERIAL PRIMARY KEY NOT NULL,

schema_id INTEGER NOT NULL REFERENCES Schemas(id) ON DELETE CASCADE,

shared_by_user_id INTEGER NOT NULL REFERENCES Users(id) ON DELETE CASCADE,

shared_with_user_id INTEGER REFERENCES Users(id) ON DELETE CASCADE,

shared_with_email VARCHAR(255),

permission VARCHAR(16) NOT NULL CHECK (permission IN ('view','edit')),

room_id VARCHAR(255),

created_at TIMESTAMP NOT NULL DEFAULT NOW(),

updated_at TIMESTAMP NOT NULL DEFAULT NOW()

);

CREATE TABLE SchemaChatMessages (

id BIGSERIAL PRIMARY KEY NOT NULL,

schema_id INTEGER NOT NULL REFERENCES Schemas(id) ON DELETE CASCADE,

user_id INTEGER REFERENCES Users(id) ON DELETE SET NULL,

role VARCHAR(16) NOT NULL CHECK (role IN ('user','system')),

content TEXT NOT NULL,

client_message_id VARCHAR(128),

created_at TIMESTAMP NOT NULL DEFAULT NOW()

);

CREATE TABLE PasswordResetTokens (

id BIGSERIAL PRIMARY KEY NOT NULL,

user_id INTEGER NOT NULL REFERENCES Users(id) ON DELETE CASCADE,

token_hash VARCHAR(255) NOT NULL,

expires_at TIMESTAMP NOT NULL,

used_at TIMESTAMP,

created_at TIMESTAMP NOT NULL DEFAULT NOW()

);
