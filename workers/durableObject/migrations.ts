// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0
// Modified by the Podbay contributors.

export interface Migration {
	name: string;
	sql: string;
}

/**
 * Minimal migration runner that replaces workers-qb's DOQB.migrations().apply().
 *
 * Uses the `d1_migrations` tracking table for backward compatibility with
 * existing deployments that were managed by workers-qb. New deployments
 * create the same table so the schema is consistent either way.
 */
export function applyMigrations(
	sql: SqlStorage,
	migrations: Migration[],
	storage?: DurableObjectStorage,
): void {
	sql.exec(`CREATE TABLE IF NOT EXISTS d1_migrations (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL UNIQUE,
		applied_at TEXT NOT NULL DEFAULT (datetime('now'))
	)`);

	for (const migration of migrations) {
		const applied = [...sql.exec(`SELECT 1 FROM d1_migrations WHERE name = ?`, migration.name)];
		if (applied.length > 0) continue;

		// Strip any existing BEGIN/COMMIT wrapper from the migration SQL.
		// Cloudflare's DO runtime forbids SQL-level transactions -- must use
		// the JS storage.transactionSync() API instead.
		let migrationSql = migration.sql.trim();
		migrationSql = migrationSql.replace(/^\s*BEGIN\s+TRANSACTION\s*;?\s*/i, "");
		migrationSql = migrationSql.replace(/\s*COMMIT\s*;?\s*$/i, "");

		const escapedName = migration.name.replace(/'/g, "''");
		const run = () => {
			sql.exec(migrationSql);
			sql.exec(`INSERT INTO d1_migrations (name) VALUES ('${escapedName}')`);
		};

		if (storage) {
			// Preferred: atomic transaction via the DO JS API
			storage.transactionSync(run);
		} else {
			// Fallback: run without explicit transaction (each exec is auto-committed)
			run();
		}
	}
}

interface DurableObjectStorage {
	transactionSync: <T>(closure: () => T) => T;
}

/**
 * Wrap SQL in a transaction so multi-statement migrations are atomic.
 *
 * Without this, a migration like `1_initial_setup` (CREATE + INSERT +
 * CREATE + CREATE) could fail mid-way and leave the database in an
 * inconsistent state that the runner considers "applied" but is
 * actually broken.  SQLite transactions guarantee all-or-nothing.
 *
 * Single-statement migrations don't strictly need it but wrapping
 * uniformly costs nothing and avoids accidental omissions.
 */
function txn(sql: string): string {
	const trimmed = sql.trim();
	// Don't double-wrap if someone already added BEGIN/COMMIT
	if (/^\s*BEGIN\b/i.test(trimmed)) return trimmed;
	return `BEGIN TRANSACTION;\n${trimmed}\nCOMMIT;`;
}

export const mailboxMigrations: Migration[] = [
	{
		name: "1_initial_setup",
		sql: txn(`
            CREATE TABLE folders (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                is_deletable INTEGER NOT NULL DEFAULT 1
            );

            INSERT INTO folders (id, name, is_deletable) VALUES
                ('inbox', 'Inbox', 0),
                ('sent', 'Sent', 0),
                ('trash', 'Trash', 0),
                ('archive', 'Archive', 0),
                ('spam', 'Spam', 0);

            CREATE TABLE emails (
                id TEXT PRIMARY KEY,
                folder_id TEXT NOT NULL,
                subject TEXT,
                sender TEXT,
                recipient TEXT,
                date TEXT,
                read INTEGER DEFAULT 0,
                starred INTEGER DEFAULT 0,
                body TEXT,
                FOREIGN KEY(folder_id) REFERENCES folders(id) ON DELETE CASCADE
            );

            CREATE TABLE attachments (
                id TEXT PRIMARY KEY,
                email_id TEXT NOT NULL,
                filename TEXT NOT NULL,
                mimetype TEXT NOT NULL,
                size INTEGER NOT NULL,
                content_id TEXT,
                disposition TEXT,
                FOREIGN KEY(email_id) REFERENCES emails(id) ON DELETE CASCADE
            );
        `),
	},
	{
		name: "2_add_email_threading",
		sql: txn(`
            ALTER TABLE emails ADD COLUMN in_reply_to TEXT;
            ALTER TABLE emails ADD COLUMN email_references TEXT;
            ALTER TABLE emails ADD COLUMN thread_id TEXT;

            CREATE INDEX idx_emails_thread_id ON emails(thread_id);
            CREATE INDEX idx_emails_in_reply_to ON emails(in_reply_to);
        `),
	},
	{
		name: "3_add_draft_folder",
		sql: txn(`INSERT INTO folders (id, name, is_deletable) VALUES ('draft', 'Drafts', 0);`),
	},
	{
		name: "4_add_message_id",
		sql: txn(`ALTER TABLE emails ADD COLUMN message_id TEXT;`),
	},
	{
		name: "5_add_raw_headers",
		sql: txn(`ALTER TABLE emails ADD COLUMN raw_headers TEXT;`),
	},
	{
		name: "6_mark_sent_emails_as_read",
		sql: txn(`UPDATE emails SET read = 1 WHERE folder_id = 'sent' AND read = 0;`),
	},
	{
		name: "7_add_cc_bcc",
		sql: txn(`
            ALTER TABLE emails ADD COLUMN cc TEXT;
            ALTER TABLE emails ADD COLUMN bcc TEXT;
        `),
	},
	{
		// No txn() wrapper: Cloudflare's DO runtime requires state.storage.transactionSync()
		// instead of SQL-level BEGIN TRANSACTION. These are idempotent CREATE INDEX IF NOT EXISTS
		// statements so they're safe to run without a transaction.
		name: "8_add_folder_date_indexes",
		sql: `
            CREATE INDEX IF NOT EXISTS idx_emails_folder_id ON emails(folder_id);
            CREATE INDEX IF NOT EXISTS idx_emails_date ON emails(date);
            CREATE INDEX IF NOT EXISTS idx_emails_folder_date ON emails(folder_id, date DESC);
        `,
	},
	{
		// ADR-0007: a message carries any number of labels. The name is unique without regard to
		// ASCII case here; the code compares names in full before it writes one.
		name: "9_labels",
		sql: `
            CREATE TABLE labels (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                color INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            );
            CREATE UNIQUE INDEX idx_labels_name ON labels(name COLLATE NOCASE);

            CREATE TABLE email_labels (
                email_id TEXT NOT NULL,
                label_id TEXT NOT NULL,
                PRIMARY KEY (email_id, label_id),
                FOREIGN KEY(email_id) REFERENCES emails(id) ON DELETE CASCADE,
                FOREIGN KEY(label_id) REFERENCES labels(id) ON DELETE CASCADE
            ) WITHOUT ROWID;
            CREATE INDEX idx_email_labels_label ON email_labels(label_id, email_id);
        `,
	},
	{
		// ADR-0007, decision 3: every folder a person made becomes a label, its messages keep the
		// label and go to Archive, and the folder is removed. The messages are moved before the
		// folder goes, so nothing can be deleted with it. Two folders whose names differ only in
		// case become one label.
		name: "10_custom_folders_become_labels",
		sql: `
            INSERT OR IGNORE INTO labels (id, name, color, created_at)
                SELECT 'lbl_' || lower(hex(randomblob(12))), name, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                FROM folders WHERE is_deletable = 1;

            INSERT OR IGNORE INTO email_labels (email_id, label_id)
                SELECT e.id, l.id
                FROM emails e
                JOIN folders f ON f.id = e.folder_id AND f.is_deletable = 1
                JOIN labels l ON l.name = f.name COLLATE NOCASE;

            UPDATE emails SET folder_id = 'archive'
                WHERE folder_id IN (SELECT id FROM folders WHERE is_deletable = 1);

            DELETE FROM folders WHERE is_deletable = 1;
        `,
	},
	{
		// An incoming message is matched to the messages it says it answers by their Message-ID.
		name: "11_message_id_index",
		sql: `CREATE INDEX IF NOT EXISTS idx_emails_message_id ON emails(message_id);`,
	},
	{
		// A draft keeps its files (ADR-0011): a file is declared, then its bytes arrive. Every
		// row that exists is a stored file, so nothing is rewritten. The index is the one the
		// table lacked: every read of a message asks for its files by the message.
		name: "12_draft_files",
		sql: `
			ALTER TABLE attachments ADD COLUMN uploading_since TEXT;
			CREATE INDEX IF NOT EXISTS idx_attachments_email ON attachments(email_id);
		`,
	},
	{
		// ADR-0014: one request acts on many conversations. A deed is what was asked (the change,
		// and for "everything" the filter, the count and the time of asking) and how far it is;
		// its changes are what each message had before: the place, a mark, a label gained or
		// lost. Neither table holds content, and both are emptied an hour after a deed.
		name: "13_deeds",
		sql: `
			CREATE TABLE deeds (
				id TEXT PRIMARY KEY,
				asked_at TEXT NOT NULL,
				unit TEXT NOT NULL,
				change TEXT NOT NULL,
				filter TEXT,
				conversations INTEGER NOT NULL DEFAULT 0,
				messages INTEGER NOT NULL DEFAULT 0,
				started_at TEXT,
				finished_at TEXT,
				position_date TEXT NOT NULL DEFAULT '',
				position_id TEXT NOT NULL DEFAULT '',
				undo_started_at TEXT
			);

			CREATE TABLE deed_changes (
				deed_id TEXT NOT NULL,
				email_id TEXT NOT NULL,
				kind TEXT NOT NULL,
				was TEXT NOT NULL,
				PRIMARY KEY (deed_id, email_id, kind, was)
			) WITHOUT ROWID;
			CREATE INDEX idx_deed_changes_email ON deed_changes(email_id);
		`,
	},
	{
		// ADR-0015: the original of a received message is kept. `raw_key` is the whole key of
		// the object that holds the bytes that arrived, and the only way to it; `raw_size` is
		// their number; `unparsed` says why a message has no parsed fields (`parser`,
		// `too_large` or `interrupted`); `auth_results` is the platform's own statement about
		// SPF, DKIM and DMARC. `arrivals` holds a message from the moment it is taken until its
		// row is written: the row is there before the bytes are, so the bucket never holds an
		// object no row names. Nothing is rewritten: every row that exists has no original.
		name: "14_originals",
		sql: `
			ALTER TABLE emails ADD COLUMN raw_key TEXT;
			ALTER TABLE emails ADD COLUMN raw_size INTEGER;
			ALTER TABLE emails ADD COLUMN unparsed TEXT;
			ALTER TABLE emails ADD COLUMN auth_results TEXT;

			CREATE TABLE arrivals (
				id TEXT PRIMARY KEY,
				raw_key TEXT NOT NULL,
				raw_size INTEGER NOT NULL,
				envelope_from TEXT NOT NULL DEFAULT '',
				started_at TEXT NOT NULL,
				attempts INTEGER NOT NULL DEFAULT 0
			);
		`,
	},
];
