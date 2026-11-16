CREATE TABLE automation_heartbeat (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  checked INTEGER NOT NULL
);
