/**
 * @author Yosuke Ota
 */
import type { AST as JSONAST } from 'jsonc-eslint-parser'
import type { AST as YAMLAST } from 'yaml-eslint-parser'
import { extname } from 'path'
import { defineCustomBlocksVisitor, getLocaleMessages } from '../utils/index'
import debugBuilder from 'debug'
import type { RuleContext, RuleListener } from '../types'
import { getCasingChecker } from '../utils/casing'
import type { LocaleMessage } from '../utils/locale-messages'
const debug = debugBuilder('eslint-plugin-vue-i18n:key-format-style')

const allowedCaseOptions = [
  'camelCase',
  'kebab-case',
  'snake_case',
  'SCREAMING_SNAKE_CASE'
] as const
type CaseOption = typeof allowedCaseOptions[number]

function create(context: RuleContext): RuleListener {
  const filename = context.getFilename()
  const expectCasing: CaseOption = context.options[0] ?? 'camelCase'
  const checker = getCasingChecker(expectCasing)
  const allowArray: boolean = context.options[1]?.allowArray

  function reportUnknown(reportNode: YAMLAST.YAMLNode) {
    context.report({
      message: `Unexpected object key. Use ${expectCasing} string key instead`,
      loc: reportNode.loc
    })
  }
  function verifyKey(
    key: string | number,
    reportNode: JSONAST.JSONNode | YAMLAST.YAMLNode
  ) {
    if (typeof key === 'number') {
      if (!allowArray) {
        context.report({
          message: `Unexpected array element`,
          loc: reportNode.loc
        })
      }
    } else {
      if (!checker(key)) {
        context.report({
          message: `"${key}" is not ${expectCasing}`,
          loc: reportNode.loc
        })
      }
    }
  }
  /**
   * Create node visitor for JSON
   */
  function createVisitorForJson(
    targetLocaleMessage: LocaleMessage
  ): RuleListener {
    type KeyStack = {
      inLocale: boolean
      node?: JSONAST.JSONNode
      upper?: KeyStack
    }
    let keyStack: KeyStack = {
      inLocale: targetLocaleMessage.isResolvedLocaleByFileName()
    }
    return {
      JSONProperty(node: JSONAST.JSONProperty) {
        const { inLocale } = keyStack
        keyStack = {
          node,
          inLocale: true,
          upper: keyStack
        }
        if (!inLocale) {
          return
        }

        const key =
          node.key.type === 'JSONLiteral' ? `${node.key.value}` : node.key.name

        verifyKey(key, node.key)
      },
      'JSONProperty:exit'() {
        keyStack = keyStack.upper!
      },
      'JSONArrayExpression > *'(
        node: JSONAST.JSONArrayExpression['elements'][number] & {
          parent: JSONAST.JSONArrayExpression
        }
      ) {
        const key = node.parent.elements.indexOf(node)
        verifyKey(key, node)
      }
    }
  }

  /**
   * Create node visitor for YAML
   */
  function createVisitorForYaml(
    targetLocaleMessage: LocaleMessage
  ): RuleListener {
    const yamlKeyNodes = new Set<YAMLAST.YAMLContent | YAMLAST.YAMLWithMeta>()

    type KeyStack = {
      inLocale: boolean
      node?: YAMLAST.YAMLNode
      upper?: KeyStack
    }
    let keyStack: KeyStack = {
      inLocale: targetLocaleMessage.isResolvedLocaleByFileName()
    }
    function withinKey(node: YAMLAST.YAMLNode) {
      for (const keyNode of yamlKeyNodes) {
        if (
          keyNode.range[0] <= node.range[0] &&
          node.range[0] < keyNode.range[1]
        ) {
          return true
        }
      }
      return false
    }
    return {
      YAMLPair(node: YAMLAST.YAMLPair) {
        const { inLocale } = keyStack
        keyStack = {
          node,
          inLocale: true,
          upper: keyStack
        }
        if (!inLocale) {
          return
        }
        if (node.key != null) {
          if (withinKey(node)) {
            return
          }
          yamlKeyNodes.add(node.key)
        }

        if (node.key == null) {
          reportUnknown(node)
        } else if (node.key.type === 'YAMLScalar') {
          const keyValue = node.key.value
          const key = typeof keyValue === 'string' ? keyValue : String(keyValue)
          verifyKey(key, node.key)
        } else {
          reportUnknown(node)
        }
      },
      'YAMLPair:exit'() {
        keyStack = keyStack.upper!
      },
      'YAMLSequence > *'(
        node: YAMLAST.YAMLSequence['entries'][number] & {
          parent: YAMLAST.YAMLSequence
        }
      ) {
        if (withinKey(node)) {
          return
        }
        const key = node.parent.entries.indexOf(node)
        verifyKey(key, node)
      }
    }
  }

  if (extname(filename) === '.vue') {
    return defineCustomBlocksVisitor(
      context,
      ctx => {
        const localeMessages = getLocaleMessages(context)
        const targetLocaleMessage = localeMessages.findBlockLocaleMessage(
          ctx.parserServices.customBlock
        )
        if (!targetLocaleMessage) {
          return {}
        }
        return createVisitorForJson(targetLocaleMessage)
      },
      ctx => {
        const localeMessages = getLocaleMessages(context)
        const targetLocaleMessage = localeMessages.findBlockLocaleMessage(
          ctx.parserServices.customBlock
        )
        if (!targetLocaleMessage) {
          return {}
        }
        return createVisitorForYaml(targetLocaleMessage)
      }
    )
  } else if (context.parserServices.isJSON || context.parserServices.isYAML) {
    const localeMessages = getLocaleMessages(context)
    const targetLocaleMessage = localeMessages.findExistLocaleMessage(filename)
    if (!targetLocaleMessage) {
      debug(`ignore ${filename} in key-format-style`)
      return {}
    }

    if (context.parserServices.isJSON) {
      return createVisitorForJson(targetLocaleMessage)
    } else if (context.parserServices.isYAML) {
      return createVisitorForYaml(targetLocaleMessage)
    }
    return {}
  } else {
    debug(`ignore ${filename} in key-format-style`)
    return {}
  }
}

export = {
  meta: {
    type: 'layout',
    docs: {
      description: 'enforce specific casing for localization keys',
      category: 'Best Practices',
      recommended: false
    },
    fixable: null,
    schema: [
      {
        enum: allowedCaseOptions
      },
      {
        type: 'object',
        properties: {
          allowArray: {
            type: 'boolean'
          }
        },
        additionalProperties: false
      }
    ]
  },
  create
}
