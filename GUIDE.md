# Genius Zero — Access & Withdrawal Guide

This step-by-step guide explains how to use **Genius Zero** to withdraw your assets from Genius Yield staking vaults, claim available rewards, and cancel open DEX orders or liquidity vaults directly from your browser.

> [!CAUTION]
> **Security First — Protect Your Recovery Phrase**
> - Genius Zero will **never** ask for your 12/15/24-word recovery phrase, seed words, or private spending password on the website.
> - **Never** share your recovery phrase, private keys, or Blockfrost API key with anyone offering "support" in DMs, Telegram, Discord, or X.
> - You only ever sign transactions inside your own Cardano browser wallet extension (`Eternl`, `Lace`, `Vespr`, etc.).

---

## Quick Links

- **Web App (Convenience Mirror):** [https://genius-zero.netlify.app](https://genius-zero.netlify.app)
- **Source Code (MIT License):** [https://github.com/geniusyield/genius-zero](https://github.com/geniusyield/genius-zero)
- **Report Technical Issues:** [https://github.com/geniusyield/genius-zero/issues](https://github.com/geniusyield/genius-zero/issues)

---

## Step 1: Obtain a Free Blockfrost API Key (2 Minutes)

Because Genius Zero runs entirely in your browser without a central Genius Yield database, it queries the Cardano blockchain directly using your own free **Blockfrost API key**.

1. Go to **[https://blockfrost.io](https://blockfrost.io)** and create a free account (or log in).
2. In your Blockfrost dashboard, click **Add project** (or **+ Create project**).
3. Enter any project name (for example, `genius-zero`) and select **Cardano Mainnet** as the network.
4. Copy the generated **Project ID** — it starts with `mainnet...` (for example, `mainnetAbCdEf123456...`).
5. Open **[https://genius-zero.netlify.app](https://genius-zero.netlify.app)** (or your own self-hosted copy).
6. Click the **Settings ⚙️** button in the top-right corner (or click **Configure Key** on the yellow banner):
   - Verify that **Active Network** is set to **Cardano Mainnet**.
   - Paste your `mainnet...` Project ID into the **Blockfrost API Key (Mainnet)** field.
   - Click **Save Configuration**.

*Privacy note: Your Blockfrost API key is stored exclusively in your own browser's `localStorage`. It is never sent to any third-party analytics or tracking server.*

---

## Step 2: Connect Your Cardano Wallet

1. Make sure your Cardano browser wallet extension (`Eternl`, `Lace`, `Vespr`, `Nami`, `Flint`, `Typhon`, or `Gero`) is set to **Mainnet** and unlocked.
   - If you use **Eternl**, make sure the dApp Browser bridge (plug icon in the top-right of Eternl) is enabled for your active wallet.
2. In Genius Zero, click **Connect Wallet** in the top-right corner and select your wallet.
3. Approve the connection prompt in your wallet extension. Your ADA balance and abbreviated address will appear in the top bar.

---

## Step 3: Withdraw from Staking Vaults (`GENS`, `GENSX`, `NTX`)

1. Click the **Staking Vaults** tab in the top navigation bar.
2. Genius Zero automatically scans all addresses and payment keys in your wallet to discover your staking vaults. Wait a few seconds for the scan to finish.
3. Locate your vault card:
   - **Unlocked Vaults:** If the lock period has ended, the vault shows an **Unlocked** badge and an active **Unstake** button.
   - **Locked Vaults:** On-chain Plutus smart contracts enforce the lock timestamp strictly on the Cardano ledger; locked vaults can only be unstaked once their unlock date is reached.
4. Click **Unstake** on your unlocked vault, review the transaction in your wallet popup (which returns your staked tokens and locked ADA deposit to your wallet), and sign.

### Troubleshooting Multi-Address Eternl Wallets ("Unable to build witness set")

If you originally created your staking vault while **Eternl** had *Single Address Mode* turned **OFF** (multi-address HD wallet mode), you might encounter one of two symptoms in Eternl v2:
- Eternl refuses to sign the unstake transaction with `"Unable to build witness set"`, or
- The address holding your vault is listed under Eternl's *Wallet → UTxO List* as **"External funds, but earning rewards"**.

**Why this happens:** The on-chain staking contract requires a signature from the specific payment key index (`0/N`) that opened the vault. Eternl v2 hardcodes a 20-address gap limit and removed the old v1 gap-limit setting, so if there is a gap of 20+ unused addresses in your wallet, Eternl v2 stops deriving keys before reaching your vault's address index.

**How to unstake using Lace Wallet (2-minute workaround):**
Unlike Eternl v2, **Lace Wallet** queries all on-chain addresses under your stake key from the blockchain and scans up to derivation index `10,000`.
1. Look at your vault card in Genius Zero (or the error message if signing failed in Eternl) and note the **Vault Owner Address** (`addr1q...`).
2. **If that owner address has never had an on-chain transaction of its own** (because legacy staking only recorded its payment key hash inside the vault datum), send **1.5–2 ADA** from your wallet to that exact `addr1q...` address and wait ~20 seconds for it to confirm on-chain. *(These funds stay in your own wallet — sending ADA to the address makes it visible on-chain so Lace indexes it during wallet recovery.)*
3. Install the official **[Lace Wallet](https://www.lace.io/)** browser extension and restore your wallet using your recovery phrase (24/15/12 words). *(If you already had Lace installed before sending the 2 ADA in step 2, remove and re-restore the wallet in Lace so it runs a fresh address discovery scan).*
4. Refresh Genius Zero (`Ctrl + F5` / `Cmd + Shift + R`), click **Connect Wallet**, choose **Lace**, go to **Staking Vaults**, and click **Unstake**. Lace will sign with the required payment key and return your staked tokens to your wallet.

---

## Step 4: Claim Available Staking & Accelerated Yield Rewards

Staking and Accelerated Yield rewards are held in on-chain reward contracts (`Vault Staking` and `Accelerated Yield`) and are claimed in a 2-step flow:

1. Click the **Claim Rewards** tab in the top navigation bar.
2. Genius Zero checks the on-chain reward pools and displays your **Claimable Rewards** breakdown across all tokens (`GENS`, `ADA`, `USDM`, `REACH`, `FLDT`, `HYN`, etc.).
3. If you have unclaimed rewards available:
   - **Step 1:** Click **Prepare Claim Transaction** and wait ~3–10 seconds while the operator co-signed withdrawal transaction is constructed.
   - **Step 2:** As soon as the button turns green (**Sign & Submit in Wallet**), click it immediately and sign the transaction in your wallet popup.

> [!NOTE]
> **Important Notes on Reward Claims**
> - **Unstaking is independent:** Withdrawing your principal from a Staking Vault (Step 3) is 100% client-side and does **not** depend on the rewards signing service.
> - **Funded distributions only:** Only rewards that have already been funded and topped up into the on-chain reward pool can be claimed. If an outstanding distribution is awaiting token funding, it will appear in the **Claim Rewards** tab once it has been topped up on-chain.

---

## Step 5: Cancel Open DEX Orders, Liquidity Vaults, or Expired Options

If you have funds locked in open DEX limit orders, Smart Liquidity Vaults, or Covered Options, you can withdraw them at any time:

- **Open DEX Limit Orders:**
  1. Open the **Trade** tab.
  2. Scroll down to the **Your Open Orders** panel at the bottom of the page.
  3. Click **Cancel** next to any open order and sign in your wallet to reclaim your remaining offered tokens and order deposit ADA.
- **Smart Liquidity Vaults (SLVs):**
  1. Open the **Liquidity Vaults** tab.
  2. Click the **My Vaults** filter button.
  3. Click **Close & Withdraw** on your vault card and sign in your wallet to burn the vault NFT and return all remaining Token A, Token B, and deposit ADA to your wallet.
- **Covered Options:**
  1. Open the **Options** tab.
  2. Under **My Written Options**, click **Reclaim Expired** on any expired option contract to burn the writer token and withdraw the underlying collateral.

---

## Step 6: Running or Hosting Your Own Copy (Optional)

The hosted app at [https://genius-zero.netlify.app](https://genius-zero.netlify.app) is provided for convenience, but Genius Zero is open-source under the MIT license and designed so you never have to rely on a single hosted website:

- **Run Locally on Your Computer:**
  ```bash
  git clone https://github.com/geniusyield/genius-zero.git
  cd genius-zero
  npm install
  npm run dev
  ```
  Then open `http://localhost:5173` in your browser.
- **Deploy Your Own Free GitHub Pages Copy (Zero Coding Required):**
  1. Visit [https://github.com/geniusyield/genius-zero](https://github.com/geniusyield/genius-zero) and click **Fork** in the top-right corner.
  2. In your forked repository, go to **Settings → Pages**.
  3. Under **Build and deployment → Source**, select **GitHub Actions**. GitHub will automatically build and publish your own copy at `https://<your-username>.github.io/genius-zero/`.

---

## Reporting Technical Issues

If you encounter a technical issue while unstaking or claiming rewards, please open an issue at:
**[https://github.com/geniusyield/genius-zero/issues](https://github.com/geniusyield/genius-zero/issues)**

**Remember: GitHub Issues are public!**
- **DO NOT** include your seed phrase, private keys, spending password, or Blockfrost API key.
- **DO** include your wallet name/version (e.g., `Eternl v2.2`, `Lace`), which tab/action failed, any error text shown on screen, and (if helpful) your public stake address (`stake1...`) or transaction hash.
