CREATE TABLE "ops_notice" (
	"key" text PRIMARY KEY NOT NULL,
	"open" boolean DEFAULT true NOT NULL,
	"detail" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_sent_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
