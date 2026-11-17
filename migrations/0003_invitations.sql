-- Invitations: the only way a second account comes to exist. The link carries a random token;
-- only its SHA-256 digest is stored, so reading this table does not let anyone accept one.

create table "invitations" (
	"id" text not null primary key,
	"email" text not null,
	"role" text not null check ("role" in ('admin', 'member')),
	"token_hash" text not null unique,
	"expires_at" text not null,
	"created_at" text not null,
	"created_by" text references "user" ("id") on delete set null,
	"accepted_at" text,
	"accepted_user_id" text references "user" ("id") on delete set null,
	"revoked_at" text
);

create index "invitations_email_idx" on "invitations" ("email");
