-- Keys for programs (MCP clients). A key belongs to one person, is limited to some of that
-- person's mailboxes and to reading or also organising and drafting, and never gives more than
-- its owner may do at the moment it is used. Only the SHA-256 digest of a key is stored.

create table "api_keys" (
	"id" text not null primary key,
	"user_id" text not null references "user" ("id") on delete cascade,
	"name" text not null,
	"token_hash" text not null unique,
	"hint" text not null,
	"access" text not null check ("access" in ('read', 'write')),
	"created_at" text not null,
	"expires_at" text,
	"revoked_at" text,
	"last_used_at" text
);

create index "api_keys_user_idx" on "api_keys" ("user_id");

create table "api_key_mailboxes" (
	"key_id" text not null references "api_keys" ("id") on delete cascade,
	"mailbox_id" text not null references "mailboxes" ("id") on delete cascade,
	primary key ("key_id", "mailbox_id")
);
