import type { SidebarsConfig } from '@docusaurus/plugin-content-docs'

const sidebars: SidebarsConfig = {
  docs: [
    'intro',
    {
      type: 'category',
      label: 'Guides',
      collapsed: false,
      items: [
        'guides/choosing-primitives',
        'guides/how-it-works',
        'guides/use-cases',
        'guides/puru-vs-piscina',
      ],
    },
    'benchmarks',
  ],
}

export default sidebars
