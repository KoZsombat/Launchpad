ALTER TABLE `apps` ADD `compose_file` text;--> statement-breakpoint
ALTER TABLE `apps` ADD `compose_path` text;--> statement-breakpoint
ALTER TABLE `apps` ADD `compose_services` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `apps` ADD `compose_project` text;--> statement-breakpoint
ALTER TABLE `apps` ADD `deploy_target` text DEFAULT 'local' NOT NULL;