import { getAttribute, isI18nBlock } from '../utils/index'
import type { RuleContext, RuleListener } from '../types'

function create(context: RuleContext): RuleListener {
  const df = context.parserServices.getDocumentFragment?.()
  if (!df) {
    return {}
  }

  return {
    Program() {
      for (const i18n of df.children.filter(isI18nBlock)) {
        const srcAttrs = getAttribute(i18n, 'src')
        if (srcAttrs != null) {
          continue
        }
        const langAttrs = getAttribute(i18n, 'lang')
        if (
          langAttrs == null ||
          langAttrs.value == null ||
          !langAttrs.value.value
        ) {
          context.report({
            loc: (langAttrs?.value ?? langAttrs ?? i18n.startTag).loc,
            messageId: 'required',
            fix(fixer) {
              if (langAttrs) {
                return fixer.replaceTextRange(langAttrs.range, 'lang="json"')
              }
              const tokenStore =
                context.parserServices.getTemplateBodyTokenStore()
              const closeToken = tokenStore.getLastToken(i18n.startTag)
              const beforeToken = tokenStore.getTokenBefore(closeToken)
              return fixer.insertTextBeforeRange(
                closeToken.range,
                (beforeToken.range[1] < closeToken.range[0] ? '' : ' ') +
                  'lang="json" '
              )
            }
          })
        }
      }
    }
  }
}

export = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'require lang attribute on `<i18n>` block',
      category: 'Best Practices',
      recommended: false
    },
    fixable: 'code',
    schema: [],
    messages: {
      required: '`lang` attribute is required.'
    }
  },
  create
}
