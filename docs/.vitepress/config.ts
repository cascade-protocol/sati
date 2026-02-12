import { defineConfig } from 'vitepress'
import llmstxt, { copyOrDownloadAsMarkdownButtons } from 'vitepress-plugin-llms'

export default defineConfig({
  markdown: {
    config(md) {
      md.use(copyOrDownloadAsMarkdownButtons)
    },
  },

  vite: {
    plugins: [llmstxt({ excludeIndexPage: false })],
  },

  title: 'SATI',
  description: 'Solana Agent Trust Infrastructure - On-chain identity and reputation for AI agents',
  base: '/',

  head: [
    ['meta', { name: 'theme-color', content: '#14F195' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'SATI - On-chain identity for AI agents' }],
    ['meta', { property: 'og:description', content: 'Verifiable track record for AI agents on Solana. Proof of participation, zero infrastructure, ~$0.002 per attestation.' }],
  ],

  themeConfig: {
    nav: [
      { text: 'Getting Started', link: '/getting-started' },
      { text: 'Guides', link: '/guides/agent-marketplace' },
      { text: 'Reference', link: '/reference/' },
      { text: 'GitHub', link: 'https://github.com/cascade-protocol/sati' },
    ],

    sidebar: [
      {
        text: 'Start Here',
        items: [
          { text: 'Home', link: '/' },
          { text: 'Getting Started', link: '/getting-started' },
          { text: 'ERC-8004 and SATI', link: '/erc-8004' },
          { text: 'How It Works', link: '/how-it-works' },
        ]
      },
      {
        text: 'Guides',
        items: [
          { text: 'Agent Marketplace', link: '/guides/agent-marketplace' },
          { text: 'x402 Payment Feedback', link: '/guides/x402-feedback' },
          { text: 'Register an MCP Agent', link: '/guides/mcp-agent' },
          { text: 'Query Reputation', link: '/guides/query-reputation' },
          { text: 'Browser Wallet Flow', link: '/guides/browser-wallet' },
        ]
      },
      {
        text: 'API Reference',
        items: [
          { text: 'Overview', link: '/reference/' },
          { text: 'sati-agent0-sdk', link: '/reference/sati-agent0-sdk' },
          { text: 'sati-sdk', link: '/reference/sati-sdk' },
        ]
      },
      {
        text: 'Deep Dive',
        items: [
          { text: 'Specification', link: '/specification' },
        ]
      },
      {
        text: 'Advanced',
        collapsed: true,
        items: [
          { text: 'Transaction Sizes', link: '/advanced/transaction-sizes' },
          { text: 'Compute Unit Benchmarks', link: '/advanced/benchmarks' },
        ]
      },
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/cascade-protocol/sati' },
    ],

    footer: {
      message: 'Released under the Apache 2.0 License.',
      copyright: 'Copyright © 2025-present Cascade Protocol'
    },

    search: {
      provider: 'local'
    }
  }
})
