# Genius Zero

> **A 100% decentralized, serverless web client for the Genius Yield DEX on Cardano.**

Genius Zero is a sovereign, open-source web application for interacting with the Genius Yield Decentralized Exchange (DEX) smart contracts on the Cardano blockchain. It requires **no central servers**, **no proprietary databases**, and **no company-hosted website**.

Users interact directly with Cardano via their own provider (e.g. Blockfrost API key) and their browser wallet (CIP-30).

---

## 🌟 Philosophy & Vision

Decentralized exchanges should not depend on centralized company infrastructure to exist. Smart contracts deployed on Cardano are immutable and perpetual—they continue to live on the blockchain regardless of whether a corporate entity or website stays online.

**Genius Zero** restores the true promise of Web3:
- **Zero Central Servers**: Runs entirely in the client's browser.
- **Zero Central Database**: Order books and staking state are reconstructed directly from on-chain UTxOs and Plutus datums.
- **Sovereign Custody**: Your wallet, your API keys, your transactions.
- **Censorship-Resistant & Unstoppable**: Can be hosted on IPFS, GitHub Pages, or run completely locally on `localhost`.

---

## 🚀 Key Features

1. **Direct On-Chain Order Book**:
   - Queries Cardano smart contract payment credentials directly via Blockfrost.
   - Parses Plutus datums in real-time to build the local bid/ask order book.
   - No intermediary indexer backend required.

2. **Full DEX Trading**:
   - **Limit Orders**: Place buy and sell limit orders with exact price ratios.
   - **Market Swaps**: Execute partial or complete fills against active liquidity in the order book.
   - **Order Cancellation**: Reclaim locked assets and order deposit ADA anytime.

3. **Smart Liquidity Vaults (SLVs) & Covered Options**:
   - **Smart Liquidity Vaults**: Inspect, create, trade against, and withdraw from fixed-price and dynamic oracle-priced (`DeltaOracle`) Aiken V3 Smart Liquidity Vaults.
   - **Covered Options**: Mint, list/buy on the secondary marketplace, exercise, and reclaim expired covered options directly on-chain.

4. **Sovereign Staking & Vault Unstaking**:
   - Inspect and interact with Genius Yield staking vaults directly on Cardano.
   - **Multi-Address HD Wallet Discovery**: Automatically scans all derived addresses and payment credentials across your wallet (`Eternl`, `Lace`, `Vespr`), ensuring that vaults created under rotated change addresses are detected and witnessed reliably.
   - Unstake principal assets and deposit ADA with direct script execution.

5. **On-Chain Rewards Claiming**:
   - Inspect active on-chain reward distribution contracts (`MerkleRewards` / `HotKeyRewards`).
   - Claim accumulated staking and accelerated yield rewards directly from the contract into your wallet.

6. **Multi-Network & Local-First Privacy**:
   - Seamless 1-click toggle between **Cardano Mainnet** and **Cardano Preprod Testnet** with independent Blockfrost key storage per network.
   - Blockfrost API keys, network preferences, and custom token lists are stored strictly in browser `localStorage` and never sent to third-party tracking services.

---

## 🌐 How to Access & Deploy Genius Zero

Genius Zero is designed so that anyone—from technical developers to ordinary community members—can use, run, or self-host it with minimal effort:

### Option 0: Community-Hosted Convenience Mirror (Instant Access)
For users who simply want to unstake, claim rewards, or trade immediately without setting up a local build or GitHub fork, a static build of the `main` branch is hosted at:
- **👉 [https://genius-zero.netlify.app](https://genius-zero.netlify.app)**
- **Bring Your Own Key**: Create a free Cardano Mainnet API key at [blockfrost.io](https://blockfrost.io) and paste it into **Settings ⚙️** (stored only in your browser's `localStorage`).
- **Don't Trust, Verify**: This mirror serves the exact static bundle built from this repository. Because Genius Zero has zero lock-in, you can switch to your own GitHub Pages fork, IPFS deployment, or local `localhost` build at any time.

### Method 1: GitHub Pages (Recommended Self-Hosting — Zero Technical Knowledge)
1. Fork this repository on GitHub by clicking the **Fork** button at the top right.
2. In your forked repository, go to **Settings** > **Pages**.
3. Under **Build and deployment** > **Source**, choose **GitHub Actions**.
4. That's it! GitHub will automatically build and publish your sovereign instance to `https://<your-username>.github.io/genius-zero/`. Every future update can be pulled with 1 click.

### Method 2: Run Locally (Desktop / Offline)
You can run Genius Zero locally on your own machine in under a minute:
```bash
# Clone the repository
git clone https://github.com/brunjlar/genius-zero.git
cd genius-zero

# Install dependencies (Node 20+)
npm install

# Start local server
npm run dev
```
Open `http://localhost:5173` in any modern web browser.

### Method 3: Static Hosting / IPFS
Because Genius Zero compiles to 100% static HTML, JS, and WebAssembly assets with relative links (`base: "./"`):
- Simply build with `npm run build`.
- Upload the contents of the `dist/` directory to **IPFS** (via Fleek or Pinata), **Cloudflare Pages**, **Netlify**, or **Vercel**.
- The app will function identically on any decentralised IPFS gateway without backend configuration.

---

## 🧪 Testing Multi-Address Unstaking on Preprod Testnet

If you or your peers had difficulty unstaking using Eternl's multi-address mode on the legacy web interface, you can verify the fix on the Cardano Preprod testnet:

1. **Configure Preprod in Eternl**:
   - Open your Eternl browser extension.
   - Switch the network to **Preprod Testnet**.
   - In Eternl Settings > Wallet, verify that **Single address mode is OFF** (allowing multi-address HD derivation).
2. **Fund Test Wallet**:
   - Request testnet ADA from the official [Cardano Testnet Faucet](https://docs.cardano.org/cardano-testnet/tools/faucet/).
3. **Open Genius Zero on Preprod**:
   - Switch network to **Preprod** via the header toggle.
   - In **Settings**, enter a free Preprod Blockfrost API key (`preprod...`).
   - Connect Eternl.
4. **Create a Test Vault**:
   - In the **Staking** tab, click **Create Test Stake**.
   - Deposit 10 test ADA into the on-chain staking script.
5. **Simulate Address Rotation**:
   - In Eternl, rotate or receive funds to a different address index (e.g. Address #1 or #2).
6. **Unstake**:
   - Return to Genius Zero's **Staking** tab. Notice that your vault is immediately detected because Genius Zero scans all payment credentials (`pkhs`) in the wallet.
   - Click **Unstake**.
   - Eternl will sign with the correct witness key for Address #0 automatically, and your principal ADA will be returned!

---

## 🛠️ Architecture & Tech Stack

- **Framework**: [React](https://react.dev/) (TypeScript) + [Vite](https://vitejs.dev/)
- **Styling & UI**: [Tailwind CSS](https://tailwindcss.com/) + [Lucide Icons](https://lucide.dev/)
- **Cardano SDK**:
  - [`@lucid-evolution/lucid`](https://github.com/Anastasia-Labs/lucid-evolution) for modern CIP-30 wallet integration and Plutus transaction building.
  - Plutus contracts integration: Reference scripts and validator credentials corresponding to Genius Yield Mainnet and Preprod contracts.
- **Blockchain Data**:
  - Direct connection to Blockfrost via user-provided project keys (stored locally).
  - Multi-address UTxO and datum resolution.

---

## 📜 License

MIT License. Free and open source for the Cardano community.
