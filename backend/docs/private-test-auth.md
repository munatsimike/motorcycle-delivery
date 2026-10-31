# Private test authentication

`PRIVATE_TEST_AUTH_ENABLED` is a temporary switch for private polishing. It is separate from `DEV_OTP_ENABLED`. The default is false.

When it is exactly `true`:

- A phone that has no account can register as a customer or rider with the shared code `000000`.
- That account is stored with `users.private_test_account = true`.
- The same account can sign in again with `000000`.
- Those requests do not call Infobip.
- A phone that already belongs to an account with `private_test_account = false` still uses the normal WhatsApp provider. The shared code does not sign that account in, and the flag is not changed.
- Rate limits, lockouts, and suspension checks still apply.
- Rider approval stays pending. Nothing in this switch approves a rider.

The customer and rider apps already submit a 6-digit code. Reviewers type `000000` after requesting a code. The apps do not display that code.

## Turn it off

Set `PRIVATE_TEST_AUTH_ENABLED=false` and restart the API.

- New codes come from the configured WhatsApp provider.
- A challenge that was issued by the test switch no longer accepts `000000`.
- `000000` works only when the normal provider generated that code.
- Rows with `private_test_account = true` stay marked. A later WhatsApp verification does not clear the column.

## Retire test accounts

Do this before a wider release. Do not set `private_test_account` back to false. That would make a disposable account look like a production identity.

1. Turn the switch off and restart the API.
2. List the marked accounts and the deliveries, wallets, and sessions that belong to them.
3. Suspend the marked accounts, or delete them only after confirming those related rows can be removed. Foreign keys restrict deletion while deliveries, wallets, or profiles still point at the account.
4. Leave `PRIVATE_TEST_AUTH_ENABLED` false.

The migration that adds the column is additive. Existing accounts stay unmarked.
