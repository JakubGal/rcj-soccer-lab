import type { NextConfig } from 'next';

const isGitHubPages = process.env.GITHUB_PAGES === 'true';
const [githubOwner = 'JakubGal', githubRepository = 'rcj-soccer-lab'] = (
  process.env.GITHUB_REPOSITORY ?? 'JakubGal/rcj-soccer-lab'
).split('/');
const isOwnerSite =
  githubRepository.toLowerCase() === `${githubOwner.toLowerCase()}.github.io`;
const githubPagesBasePath = isOwnerSite ? '' : `/${githubRepository}`;
const githubPagesOrigin = `https://${githubOwner.toLowerCase()}.github.io`;

const nextConfig: NextConfig = isGitHubPages
  ? {
      output: 'export',
      // Vinext beta currently returns a 404 from its prerender server when a
      // basePath is combined with output: 'export'. Pages already mounts the
      // exported artifact at the repository path, so only static asset URLs
      // need the absolute prefix.
      assetPrefix: `${githubPagesOrigin}${githubPagesBasePath}`,
      trailingSlash: true,
    }
  : {};

export default nextConfig;
