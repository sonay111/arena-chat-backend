-- Removes the test data these fixtures create (keyed to USER_ID, plus the
-- real userId Satyam's example payloads use). Run after send-all.sh if you
-- don't want the fixture rows sitting in your local dev database:
--   docker exec -i chat-test-pg psql -U postgres -d chatdb < test-fixtures/webhooks/cleanup.sql
DELETE FROM raw_webhook_events WHERE user_id IN ('USER_ID', '6a7190b86bf3e098b45faba6');
DELETE FROM bonuses WHERE user_id IN ('USER_ID', '6a7190b86bf3e098b45faba6');
DELETE FROM bets WHERE user_id IN ('USER_ID', '6a7190b86bf3e098b45faba6');
DELETE FROM payments WHERE user_id IN ('USER_ID', '6a7190b86bf3e098b45faba6');
DELETE FROM player_wallets WHERE user_id IN ('USER_ID', '6a7190b86bf3e098b45faba6');
DELETE FROM players WHERE id IN ('USER_ID', '6a7190b86bf3e098b45faba6');
