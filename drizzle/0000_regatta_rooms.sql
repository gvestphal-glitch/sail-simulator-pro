CREATE TABLE rooms (
  code TEXT PRIMARY KEY,
  settings TEXT NOT NULL,
  created INTEGER NOT NULL,
  expires INTEGER NOT NULL,
  starts INTEGER
);
--> statement-breakpoint
CREATE TABLE sailors (
  room TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE,
  seat INTEGER NOT NULL CHECK (seat BETWEEN 0 AND 5),
  id TEXT NOT NULL,
  token TEXT NOT NULL,
  name TEXT NOT NULL,
  seen INTEGER NOT NULL,
  boat TEXT,
  PRIMARY KEY(room, seat),
  UNIQUE(room, id)
);
--> statement-breakpoint
CREATE INDEX rooms_expiration ON rooms(expires);
