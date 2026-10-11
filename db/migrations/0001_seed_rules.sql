-- Rules as data: RuleSet version 1 (rating specification v1.1, section 1) and the three launch
-- formats (concept section 4). Later changes create new versions instead of editing these rows.

INSERT INTO `rulesets` (`version`, `params_json`, `valid_from`, `note`, `created_by`, `created_at`)
VALUES (
  1,
  '{"rDefault":1500,"scale":173.7178,"tau":0.5,"sigmaStart":0.06,"rdUnknown":350,"rdStart":200,"graceDays":30,"cInact":0.94,"kDisplay":2,"provisionalRd":110,"minBattles":5,"weights":{"1":0.25,"2":0.5,"3":1,"4":1.5,"5":2},"kPoints":2,"clamp":"winner","comboMissingZ":-1,"comboMinPop":10,"comboFallbackSd":250,"overrateZ":-3,"volatilityEpsilon":0.000001}',
  1791676800000,
  'Initial values of the rating specification',
  NULL,
  1791676800000
);
--> statement-breakpoint
INSERT INTO `formats` (`id`, `slug`, `name`, `description`, `status`, `k_points`, `merged_into`, `created_by`, `created_at`, `archived_at`)
VALUES
  ('01a12842-5c00-701e-b6c0-4a930af3272a', 'trick-combo-3', '3-Trick Combo', 'A combo of exactly 3 tricks.', 'relevant', NULL, NULL, NULL, 1791676800000, NULL),
  ('01a12842-5c01-7a3f-afae-5e7aeb8912cb', 'bounce-combo-10', '10-Bounce Combo', 'A combo of exactly 10 bounces.', 'relevant', NULL, NULL, NULL, 1791676800000, NULL),
  ('01a12842-5c02-7d6b-bce2-b6212ef6a4df', 'best-trick', 'Best Trick', 'Your single best trick.', 'relevant', NULL, NULL, NULL, 1791676800000, NULL);
--> statement-breakpoint
INSERT INTO `format_versions` (`format_id`, `version`, `parts_json`, `created_by`, `created_at`)
VALUES
  ('01a12842-5c00-701e-b6c0-4a930af3272a', 1, '[{"kind":"trick_combo","count":3}]', NULL, 1791676800000),
  ('01a12842-5c01-7a3f-afae-5e7aeb8912cb', 1, '[{"kind":"bounce_combo","count":10}]', NULL, 1791676800000),
  ('01a12842-5c02-7d6b-bce2-b6212ef6a4df', 1, '[{"kind":"best_trick","count":1}]', NULL, 1791676800000);
