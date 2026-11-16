CREATE TABLE articles (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  topic TEXT NOT NULL,
  summary TEXT NOT NULL,
  body TEXT NOT NULL,
  source TEXT NOT NULL,
  image TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'queued', 'rehearsed')),
  due INTEGER,
  updated INTEGER NOT NULL,
  rehearsed INTEGER
);
--> statement-breakpoint
CREATE INDEX articles_owner_updated ON articles (owner, updated DESC);
--> statement-breakpoint
CREATE INDEX articles_state_due ON articles (state, due);
