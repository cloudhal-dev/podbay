-- A person's choices about how the mail screens look and behave (ADR-0012): one row for a
-- person who chose something, none for a person who never did. `choices` is one JSON document,
-- `{ "v": 1, … }`, that holds only what the person chose; the schema both sides share
-- (shared/choices.ts) says which keys and values there are. `rev` counts the writes. The row
-- goes with the account. Nothing here is mail, and the Worker decides nothing by it.

create table "user_choices" (
	"user_id" text not null primary key references "user" ("id") on delete cascade,
	"choices" text not null default '{"v":1}',
	"rev" integer not null default 1,
	"updated_at" text not null
);
