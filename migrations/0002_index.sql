-- Podbay's index: who may do what, and which mailboxes exist. Mail content is not here; it lives
-- in one Durable Object per mailbox. Additive changes only: a later migration adds, never edits.

create table "instance_roles" (
	"user_id" text not null primary key references "user" ("id") on delete cascade,
	"role" text not null check ("role" in ('owner', 'admin', 'member')),
	"created_at" text not null
);

create table "mailboxes" (
	"id" text not null primary key,
	"address" text not null unique,
	"display_name" text not null,
	"settings" text not null default '{}',
	"created_at" text not null,
	"created_by" text references "user" ("id") on delete set null,
	"rev" integer not null default 1
);

create table "memberships" (
	"mailbox_id" text not null references "mailboxes" ("id") on delete cascade,
	"user_id" text not null references "user" ("id") on delete cascade,
	"role" text not null check ("role" in ('owner', 'sender', 'reader')),
	"created_at" text not null,
	"created_by" text references "user" ("id") on delete set null,
	primary key ("mailbox_id", "user_id")
);

create index "memberships_user_idx" on "memberships" ("user_id");

-- Who did what and when. Never message content, never an address of a correspondent.
create table "audit" (
	"id" text not null primary key,
	"at" text not null,
	"actor_user_id" text,
	"action" text not null,
	"target" text,
	"detail" text
);

create index "audit_at_idx" on "audit" ("at");
