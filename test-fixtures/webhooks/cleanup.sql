-- Removes the test data these fixtures create (all keyed to USER_ID).
-- Run after send-all.sh if you don't want the fixture rows sitting in
-- your local dev database:
--   docker exec -i chat-test-pg psql -U postgres -d chatdb < test-fixtures/webhooks/cleanup.sql
DELETE FROM raw_webhook_events WHERE user_id = 'USER_ID';
DELETE FROM bonuses WHERE user_id = 'USER_ID';
DELETE FROM bets WHERE user_id = 'USER_ID';
DELETE FROM payments WHERE user_id = 'USER_ID';
DELETE FROM player_wallets WHERE user_id = 'USER_ID';
DELETE FROM players WHERE id = 'USER_ID';
