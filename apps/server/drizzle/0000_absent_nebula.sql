CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_user_id_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE TABLE `apps` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`subdomain` text NOT NULL,
	`source_type` text NOT NULL,
	`image_ref` text,
	`registry_username` text,
	`registry_password_enc` text,
	`repo_url` text,
	`branch` text,
	`dockerfile_path` text,
	`build_context` text,
	`repo_token_enc` text,
	`internal_port` integer NOT NULL,
	`health_path` text DEFAULT '/' NOT NULL,
	`env_vars` text DEFAULT '[]' NOT NULL,
	`volumes` text DEFAULT '[]' NOT NULL,
	`cicd_enabled` integer DEFAULT false NOT NULL,
	`webhook_secret_enc` text NOT NULL,
	`status` text DEFAULT 'stopped' NOT NULL,
	`container_id` text,
	`image_tag` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `apps_name_unique` ON `apps` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `apps_subdomain_unique` ON `apps` (`subdomain`);--> statement-breakpoint
CREATE TABLE `deployments` (
	`id` text PRIMARY KEY NOT NULL,
	`app_id` text NOT NULL,
	`status` text NOT NULL,
	`trigger` text NOT NULL,
	`image_tag` text,
	`commit_sha` text,
	`log` text DEFAULT '' NOT NULL,
	`error` text,
	`queued_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	FOREIGN KEY (`app_id`) REFERENCES `apps`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `deployments_app_id_idx` ON `deployments` (`app_id`);--> statement-breakpoint
CREATE INDEX `deployments_queued_at_idx` ON `deployments` (`queued_at`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_user_id_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`id` text PRIMARY KEY NOT NULL,
	`base_domain` text,
	`github_token_enc` text,
	`ghcr_username` text,
	`ghcr_token_enc` text,
	`ssh_host` text,
	`ssh_port` integer,
	`ssh_username` text,
	`ssh_auth_method` text,
	`ssh_password_enc` text,
	`ssh_private_key_enc` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);