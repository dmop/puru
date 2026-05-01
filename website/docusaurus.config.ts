import type { Config } from '@docusaurus/types'
import type * as Preset from '@docusaurus/preset-classic'
import { themes as prismThemes } from 'prism-react-renderer'

const config: Config = {
  title: 'puru',
  tagline: 'Go-style concurrency and parallelism for JavaScript',
  url: 'https://dmop.github.io',
  baseUrl: '/puru/',
  organizationName: 'dmop',
  projectName: 'puru',
  trailingSlash: false,
  onBrokenLinks: 'throw',

  markdown: {
    mermaid: true,
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },

  themes: ['@docusaurus/theme-mermaid'],

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          editUrl: 'https://github.com/dmop/puru/edit/main/website/',
          routeBasePath: 'docs',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  plugins: [
    [
      'docusaurus-plugin-typedoc',
      {
        entryPoints: ['../src/index.ts'],
        tsconfig: './typedoc.tsconfig.json',
        out: 'docs/api',
        exclude: [
          '**/node_modules/**',
          '../src/adapters/**',
          '../src/bootstrap.ts',
          '../src/serialize.ts',
        ],
        excludePrivate: true,
        excludeInternal: true,
        readme: 'none',
        sidebar: {
          autoConfiguration: true,
          pretty: true,
        },
      },
    ],
  ],

  themeConfig: {
    navbar: {
      title: 'puru (プール)',
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docs',
          position: 'left',
          label: 'Docs',
        },
        {
          to: '/docs/api',
          position: 'left',
          label: 'API',
        },
        {
          href: 'https://www.npmjs.com/package/@dmop/puru',
          label: 'npm',
          position: 'right',
        },
        {
          href: 'https://github.com/dmop/puru',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            { label: 'Introduction', to: '/docs/intro' },
            { label: 'Choosing Primitives', to: '/docs/guides/choosing-primitives' },
            { label: 'API Reference', to: '/docs/api' },
          ],
        },
        {
          title: 'More',
          items: [
            { label: 'GitHub', href: 'https://github.com/dmop/puru' },
            { label: 'npm', href: 'https://www.npmjs.com/package/@dmop/puru' },
            { label: 'Changelog', href: 'https://github.com/dmop/puru/blob/main/CHANGELOG.md' },
          ],
        },
      ],
      copyright: `MIT License · Built with Docusaurus`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['typescript', 'bash'],
    },
    colorMode: {
      defaultMode: 'light',
      disableSwitch: false,
      respectPrefersColorScheme: true,
    },
  } satisfies Preset.ThemeConfig,
}

export default config
