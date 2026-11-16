CREATE TABLE publications (
  article_id TEXT PRIMARY KEY REFERENCES articles(id),
  state TEXT NOT NULL,
  publish_id TEXT,
  public_url TEXT,
  message TEXT,
  updated INTEGER NOT NULL
);
