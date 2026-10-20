/** Product identity stays in the title; translated descriptions explain functionality. */
export function validateBrandNames(config, registry) {
  if (registry.schema !== 1 || !Array.isArray(registry.entries)) throw new Error('Invalid brand-name registry');
  const byName = new Map(config.packages.map(plugin => [plugin.name, plugin]));
  for (const entry of registry.entries) {
    const plugin = byName.get(entry.name);
    if (!plugin) continue;
    for (const language of ['en', 'zh']) {
      if (!plugin.title?.[language]?.includes(entry.brand)) throw new Error(`Preserve product name ${entry.brand} in ${language}: ${entry.name}`);
    }
  }
}

/** Update editorial copy while retaining checked package versions, metrics and all sort ranks. */
export function applyCatalogCopy(index, display, config, github) {
  const byName = new Map(config.packages.map(plugin => [plugin.name, plugin]));
  const presentations = {...display.plugins};
  const plugins = index.plugins.map(plugin => {
    const source = byName.get(plugin.name);
    if (!source) throw new Error('Published plugin is absent from sources: ' + plugin.name);
    const original = source.description ?? display.plugins[plugin.name]?.description;
    const description = typeof original === 'string' ? {en: original, zh: original} : {...original};
    const repoKey = plugin.repository?.url?.replace(/^https?:\/\/(?:www\.)?github\.com\//, '').replace(/\.git\/?$/, '').replace(/\/$/, '').toLowerCase();
    const repo = github.repositories?.[repoKey];
    const hasStars = repo && ['ok', 'stale'].includes(repo.status) && Number.isSafeInteger(repo.stars) && repo.stars >= 0;
    const composed = {...description};
    for (const language of ['en', 'zh']) {
      const stars = hasStars ? '★ ' + new Intl.NumberFormat(language === 'zh' ? 'zh-CN' : 'en-US').format(repo.stars) : undefined;
      if (stars) composed[language] = stars + (description[language] ? ' │ ' + description[language] : '');
    }
    presentations[plugin.name] = {...presentations[plugin.name], description};
    return {...plugin, ...(source.title ? {title: source.title} : {}), description: composed};
  });
  return {index: {...index, plugins}, display: {...display, plugins: presentations}};
}
