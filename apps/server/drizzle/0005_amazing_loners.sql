ALTER TABLE `apps` ADD `access` text DEFAULT 'http' NOT NULL;--> statement-breakpoint
ALTER TABLE `apps` ADD `host_port` integer;--> statement-breakpoint
ALTER TABLE `apps` ADD `port_protocol` text DEFAULT 'tcp' NOT NULL;