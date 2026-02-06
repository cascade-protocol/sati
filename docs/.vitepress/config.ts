import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'SATI',
  description: 'Solana Agent Trust Infrastructure - Open trust layer for AI agents',
  base: '/sati/',

  head: [
    ['meta', { name: 'theme-color', content: '#14F195' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'SATI - Solana Agent Trust Infrastructure' }],
    ['meta', { property: 'og:description', content: 'Production-ready agent reputation on Solana. ~$0.002 per attestation.' }],
  ],

  themeConfig: {
    nav: [
      { text: 'Guide', link: '/getting-started' },
      { text: 'Specification', link: '/specification' },
      { text: 'SDK', link: 'https://www.npmjs.com/package/@cascade-fyi/sati-sdk' },
      { text: 'GitHub', link: 'https://github.com/cascade-protocol/sati' },
    ],

    sidebar: [
      {
        text: 'Introduction',
        items: [
          { text: 'What is SATI?', link: '/' },
          { text: 'Getting Started', link: '/getting-started' },
        ]
      },
      {
        text: 'Guide',
        items: [
          { text: 'Core Concepts', link: '/guide/concepts' },
          { text: 'Agent Registration', link: '/guide/agent-registration' },
          { text: 'Feedback & Reputation', link: '/guide/feedback' },
          { text: 'Delegation', link: '/guide/delegation' },
        ]
      },
      {
        text: 'Concepts',
        items: [
          { text: 'Validation', link: '/concepts/validation' },
        ]
      },
      {
        text: 'Reference',
        items: [
          { text: 'Specification', link: '/specification' },
        ]
      },
      {
        text: 'Known Issues',
        items: [
          { text: 'Close Attestation Offset', link: '/known-issues/close-attestation-offset' },
        ]
      }
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
