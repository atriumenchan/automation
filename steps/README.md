# Step-by-Step Account Creation

Each script does exactly ONE action. Run them in order, check the screenshot after each.

## Setup (run once per account)
```
node steps/init.js
```

## The Steps

| Script | Action |
|---|---|
| `s01_navigate.js` | Open Ads signup URL |
| `s02_click_signin.js` | Click "Sign in" on homepage |
| `s03_continue_microsoft.js` | Click "Continue with Microsoft" |
| `s04_enter_email.js` | Type account email |
| `s05_click_next.js` | Click Next after email |
| `s06_enter_password.js` | Type password (visible field only) |
| `s07_click_signin_btn.js` | Click Sign-in / Next |
| `s08_look.js` | **Just screenshot — see what page is showing** |
| `s09_stay_signed_in.js` | Click "Yes" on Stay signed in |
| `s10_pick_account_tile.js` | Click account tile in picker |
| `s11_secondary_email.js` | Enter Rambler email when prompted |
| `s12_enter_otp.js` | Get OTP from Rambler IMAP + fill it |
| `s13_click_next_generic.js` | Generic Next/Submit/Verify button |
| `s14_fill_website.js` | Fill website URL on Ads form |
| `s15_fill_business_name.js` | Fill business name |
| `s16_fill_phone_email.js` | Fill phone + contact email |
| `s17_check_checkboxes.js` | Check all checkboxes |
| `s18_click_create_account.js` | Click "Create account" |
| `s19_create_account_only.js` | Select "Create account only" card |
| `s13_click_next_generic.js` | Click Next after card selection |
| `s20_fill_address.js` | Fill full address form |
| `s13_click_next_generic.js` | Click Next after address |
| `s21_payment_later.js` | Click "Set up payment later" |
| `s22_click_yes_confirm.js` | Click "Yes" on confirmation |
| `s23_click_create_campaign.js` | Click "Create Campaign" (FINAL) |
| `s24_mark_success.js` | Mark account as done in JSON files |

## Tips
- Use `s08_look.js` any time you're not sure what page you're on
- Each script saves a session — if a step fails, just re-run it
- Screenshots saved to `steps/screenshots/`
- Current state always in `steps/state.json`
