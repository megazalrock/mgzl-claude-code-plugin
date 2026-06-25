CREATE TABLE `findings` (
	`id` text PRIMARY KEY NOT NULL,
	`report_id` text NOT NULL,
	`body` text NOT NULL,
	`target_path` text,
	`line_start` integer,
	`line_end` integer,
	`code_before` text,
	`code_after` text,
	`severity` integer NOT NULL,
	`category` text NOT NULL,
	`reporter` text NOT NULL,
	`verdict` text,
	`verdict_reason` text,
	FOREIGN KEY (`report_id`) REFERENCES `reports`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "severity_range" CHECK("findings"."severity" BETWEEN 1 AND 5),
	CONSTRAINT "category_enum" CHECK("findings"."category" IN ('design','logic','style','comments','security','performance','test')),
	CONSTRAINT "verdict_enum" CHECK("findings"."verdict" IS NULL OR "findings"."verdict" IN ('tp','fp','nit','oos'))
);
--> statement-breakpoint
CREATE INDEX `idx_findings_report_id` ON `findings` (`report_id`);--> statement-breakpoint
CREATE INDEX `idx_findings_verdict` ON `findings` (`verdict`);--> statement-breakpoint
CREATE INDEX `idx_findings_reporter` ON `findings` (`reporter`);--> statement-breakpoint
CREATE TABLE `reports` (
	`id` text PRIMARY KEY NOT NULL,
	`file_path` text NOT NULL,
	`created_at` text NOT NULL,
	`model` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reports_file_path_unique` ON `reports` (`file_path`);