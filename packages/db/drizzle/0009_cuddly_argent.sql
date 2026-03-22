CREATE TABLE "par_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"request_uri" text NOT NULL,
	"client_id" uuid NOT NULL,
	"parameters" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "par_requests_request_uri_unique" UNIQUE("request_uri")
);
--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD COLUMN "dpop_jkt" text;--> statement-breakpoint
ALTER TABLE "par_requests" ADD CONSTRAINT "par_requests_client_id_oauth_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("id") ON DELETE cascade ON UPDATE no action;