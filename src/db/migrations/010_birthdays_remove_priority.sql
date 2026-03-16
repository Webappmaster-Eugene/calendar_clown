-- Birthdays should not be priority by default — user can enable manually per date.
-- Fixes migration 008 which incorrectly set all birthdays to is_priority = true.
UPDATE notable_dates SET is_priority = false WHERE event_type = 'birthday' AND is_priority = true;
