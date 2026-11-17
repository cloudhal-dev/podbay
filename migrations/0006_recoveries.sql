-- Recovery links: the way back in for a person who can no longer sign in. An owner or an
-- administrator issues one for another person; the operator issues one for an owner with the
-- setup token. The link carries a random token; only its SHA-256 digest is stored, so reading
-- this table does not let anyone use one. A link works once and for a limited time.

create table "recoveries" (
	"id" text not null primary key,
	"user_id" text not null references "user" ("id") on delete cascade,
	"token_hash" text not null unique,
	"created_at" text not null,
	"expires_at" text not null,
	-- Who issued it. Null means the operator, with the setup token.
	"issued_by" text references "user" ("id") on delete set null,
	"used_at" text,
	"revoked_at" text
);

create index "recoveries_user_idx" on "recoveries" ("user_id");
