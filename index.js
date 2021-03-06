import tinycolor from 'tinycolor2'
import { SVGPathData, encodeSVGPath, SVGPathDataTransformer } from 'svg-pathdata'
import rough from 'roughjs/bundled/rough.esm'

var units = require('units-css')

/**
 * A small helper class that represents a point.
 */
class Point {
  /**
   * @return {number}
   */
  get x() {
    return this.$x
  }
  /**
   * @return {number}
   */
  get y() {
    return this.$y
  }
  /**
   * @param {number} x
   * @param {number} y
   */
  constructor(x, y) {
    this.$x = x || 0
    this.$y = y || 0
  }

  toString() {
    return `${this.x},${this.y}`
  }
}

export class RenderMode {
  static get SVG() {
    return 'RenderMode.SVG'
  }
  static get CANVAS() {
    'RenderMode.CANVAS'
  }
}

/**
 * Svg2Roughjs parses a given SVG and draws it with Rough.js
 * in a canvas.
 */
export class Svg2Roughjs {
  /**
   * A simple regexp which is used to test whether a given string value
   * contains unit identifiers, e.g. "1px", "1em", "1%", ...
   * @private
   * @returns {RegExp}
   */
  static CONTAINS_UNIT_REGEXP() {
    return /[a-z%]/
  }

  /**
   * The SVG that should be converted.
   * Changing this property triggers drawing of the SVG into
   * the canvas or container element with which Svg2Roughjs
   * was initialized.
   * @param {SVGSVGElement} svg
   */
  set svg(svg) {
    if (this.$svg !== svg) {
      /** @type {SVGSVGElement} */
      this.$svg = svg

      if (svg.hasAttribute('width')) {
        this.width = svg.width.baseVal.value
      } else if (svg.hasAttribute('viewBox')) {
        this.width = svg.viewBox.baseVal.width
      } else {
        this.width = 300
      }

      if (svg.hasAttribute('height')) {
        this.height = svg.height.baseVal.value
      } else if (svg.hasAttribute('viewBox')) {
        this.height = svg.viewBox.baseVal.height
      } else {
        this.height = 150
      }

      if (this.renderMode === RenderMode.CANVAS) {
        this.canvas.width = this.width
        this.canvas.height = this.height
      } else {
        this.canvas.setAttribute('width', this.width)
        this.canvas.setAttribute('height', this.height)
      }

      // pre-process defs for subsequent references
      this.collectElementsWithID()

      this.redraw()
    }
  }
  /**
   * @return {SVGSVGElement}
   */
  get svg() {
    return this.$svg
  }

  /**
   * Rough.js config object that is provided to Rough.js for drawing
   * any SVG element.
   * Changing this property triggers a repaint.
   * @param {object}
   */
  set roughConfig(config) {
    this.$roughConfig = config
    if (this.renderMode === RenderMode.CANVAS) {
      this.rc = rough.canvas(this.canvas, this.$roughConfig)
    } else {
      this.rc = rough.svg(this.canvas, this.$roughConfig)
    }
    this.redraw()
  }

  /**
   * @return {object}
   */
  get roughConfig() {
    return this.$roughConfig
  }

  /**
   * Set a font-family for the rendering of text elements.
   * If set to `null`, then the font-family of the SVGTextElement is used.
   * By default, 'Comic Sans MS, cursive' is used.
   * Changing this property triggers a repaint.
   * @param {string | null}
   */
  set fontFamily(fontFamily) {
    if (this.$fontFamily !== fontFamily) {
      this.$fontFamily = fontFamily
      this.redraw()
    }
  }

  /**
   * @returns {string}
   */
  get fontFamily() {
    return this.$fontFamily
  }

  /**
   * Whether to randomize Rough.js' fillWeight, hachureAngle and hachureGap.
   * Also randomizes the disableMultiStroke option of Rough.js.
   * By default true.
   * Changing this property triggers a repaint.
   * @param {boolean}
   */
  set randomize(randomize) {
    this.$randomize = randomize
    this.redraw()
  }

  /**
   * @returns {boolean}
   */
  get randomize() {
    return this.$randomize
  }

  /**
   * Optional solid background color with which
   * the canvas should be initialized.
   * It is drawn on a transparent canvas by default.
   * @param {string}
   */
  set backgroundColor(color) {
    this.$backgroundColor = color
  }

  /**
   * @returns {string}
   */
  get backgroundColor() {
    return this.$backgroundColor
  }

  /**
   * Changes the output format of the converted SVG.
   * Changing this property, will replace the current output
   * element with either a new HTML canvas or new SVG element.
   * @param {RenderMode} mode
   */
  set renderMode(mode) {
    if (this.$renderMode === mode) {
      return
    }
    this.$renderMode = mode

    const parent = this.canvas.parentElement
    parent.removeChild(this.canvas)

    let target
    if (mode === RenderMode.CANVAS) {
      target = document.createElement('canvas')
      target.width = this.width
      target.height = this.height
      this.ctx = target.getContext('2d')
    } else {
      this.ctx = null
      target = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      target.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
      target.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')
      target.setAttribute('width', this.width)
      target.setAttribute('height', this.height)
    }
    parent.appendChild(target)
    this.canvas = target

    if (mode === RenderMode.CANVAS) {
      this.rc = rough.canvas(this.canvas, this.$roughConfig)
    } else {
      this.rc = rough.svg(this.canvas, this.$roughConfig)
    }

    this.redraw()
  }

  /**
   * @returns {RenderMode}
   */
  get renderMode() {
    return this.$renderMode
  }

  /**
   * Whether to apply a pencil filter.
   * Only works for SVG render mode.
   * @param {boolean}
   */
  set pencilFilter(value) {
    if (this.$pencilFilter !== value) {
      this.$pencilFilter = value
      this.redraw()
    }
  }

  /**
   * @returns {boolean}
   */
  get pencilFilter() {
    return this.$pencilFilter
  }

  /**
   * Creates a new instance of Svg2roughjs.
   * @param {string | HTMLCanvasElement | SVGSVGElement} target Either a selector for the container to which a canvas should be added
   * or an `HTMLCanvasElement` or `SVGSVGElement` that should be used as output target.
   * @param {RenderMode?} renderMode Whether the output should be an SVG or drawn to an HTML canvas.
   * Defaults to SVG or CANVAS depending if the given target is of type `HTMLCanvasElement` or `SVGSVGElement`,
   * otherwise it defaults to SVG.
   * @param {object?} roughConfig Config object this passed to the Rough.js ctor and
   * also used while parsing the styles for `SVGElement`s.
   */
  constructor(target, renderMode = RenderMode.SVG, roughConfig = {}) {
    if (!target) {
      throw new Error('No target provided')
    }
    if (typeof target === 'object') {
      if (target.tagName === 'canvas' || target.tagName === 'svg') {
        this.canvas = target
        this.$renderMode = target.tagName === 'canvas' ? RenderMode.CANVAS : RenderMode.SVG
      } else {
        throw new Error('Target object is not of type HMTLCanvaseElement or SVGSVGElement')
      }
    } else if (typeof target === 'string') {
      // create a new HTMLCanvasElement as child of the given element
      const container = document.querySelector(target)
      if (!container) {
        throw new Error(`No element found with ${target}`)
      }
      if (renderMode === RenderMode.CANVAS) {
        this.canvas = document.createElement('canvas')
        this.canvas.width = container.clientWidth
        this.canvas.height = container.clientHeight
      } else {
        this.canvas = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
        this.canvas.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
        this.canvas.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')
      }
      this.$renderMode = renderMode
      container.appendChild(this.canvas)
    }

    // the Rough.js instance to draw the SVG elements
    if (this.renderMode === RenderMode.CANVAS) {
      this.rc = rough.canvas(this.canvas, roughConfig)
      // canvas context for convenient access
      this.ctx = this.canvas.getContext('2d')
    } else {
      this.rc = rough.svg(this.canvas, roughConfig)
    }
    this.$roughConfig = roughConfig

    // default font family
    this.$fontFamily = 'Comic Sans MS, cursive'

    // we randomize the visualization per element by default
    this.$randomize = true
  }

  /**
   * Triggers an entire redraw of the SVG which also
   * processes it anew.
   */
  redraw() {
    if (!this.svg) {
      return
    }

    // reset target element
    if (this.renderMode === RenderMode.CANVAS) {
      this.initializeCanvas(this.canvas)
    } else {
      this.initializeSvg(this.canvas)
    }

    this.processRoot(this.svg, null, this.width, this.height)
  }

  /**
   * Prepares the given canvas element depending on the set properties.
   * @private
   * @param {HTMLCanvasElement} canvas
   */
  initializeCanvas(canvas) {
    this.ctx = canvas.getContext('2d')
    this.ctx.clearRect(0, 0, this.width, this.height)
    if (this.backgroundColor) {
      this.ctx.fillStyle = this.backgroundColor
      this.ctx.fillRect(0, 0, this.width, this.height)
    }
  }

  /**
   * Prepares the given SVG element depending on the set properties.
   * @private
   * @param {SVGSVGElement} svgElement
   */
  initializeSvg(svgElement) {
    // maybe canvas rendering was used before
    this.ctx = null

    // clear SVG element
    while (svgElement.firstChild) {
      svgElement.removeChild(svgElement.firstChild)
    }

    // apply backgroundColor
    let backgroundElement
    if (this.backgroundColor) {
      backgroundElement = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
      backgroundElement.width.baseVal.value = this.width
      backgroundElement.height.baseVal.value = this.height
      backgroundElement.setAttribute('fill', this.backgroundColor)
      svgElement.appendChild(backgroundElement)
    }

    // prepare filter effects
    if (this.pencilFilter) {
      const defs = this.getDefsElement(svgElement)
      defs.appendChild(SvgTextures.pencilTextureFilter)
    }
  }

  /**
   * Traverses the SVG in DFS and draws each element to the canvas.
   * @private
   * @param {SVGSVGElement | SVGGElement} root either an SVG- or g-element
   * @param {SVGTransform?} svgTransform
   * @param {number?} width Use elements can overwrite width
   * @param {number?} height Use elements can overwrite height
   */
  processRoot(root, svgTransform, width, height) {
    // traverse svg in DFS
    const stack = []

    if (root.tagName === 'svg' || root.tagName === 'symbol' || root.tagName === 'marker') {
      let rootX = 0
      let rootY = 0
      if (root.tagName === 'symbol') {
        rootX = parseFloat(root.getAttribute('x')) || 0
        rootY = parseFloat(root.getAttribute('y')) || 0
        width = width || parseFloat(root.getAttribute('width')) || void 0
        height = height || parseFloat(root.getAttribute('height')) || void 0
      } else if (root.tagName === 'marker') {
        rootX = -root.refX.baseVal.value
        rootY = -root.refY.baseVal.value
        width = width || parseFloat(root.getAttribute('markerWidth')) || void 0
        height = height || parseFloat(root.getAttribute('markerHeight')) || void 0
      } else {
        rootX = root.x.baseVal.value
        rootY = root.y.baseVal.value
      }

      let rootTransform = this.svg.createSVGMatrix()

      if (
        typeof width !== 'undefined' &&
        typeof height !== 'undefined' &&
        root.getAttribute('viewBox')
      ) {
        const {
          x: viewBoxX,
          y: viewBoxY,
          width: viewBoxWidth,
          height: viewBoxHeight
        } = root.viewBox.baseVal

        // viewBox values might scale the SVGs content
        if (root.tagName === 'marker') {
          // refX / refY works differently on markers than the x / y attribute
          rootTransform = rootTransform
            .translate(-viewBoxX * (width / viewBoxWidth), -viewBoxY * (height / viewBoxHeight))
            .scaleNonUniform(width / viewBoxWidth, height / viewBoxHeight)
            .translate(rootX, rootY)
        } else {
          rootTransform = rootTransform
            .translate(-viewBoxX * (width / viewBoxWidth), -viewBoxY * (height / viewBoxHeight))
            .translate(rootX, rootY)
            .scaleNonUniform(width / viewBoxWidth, height / viewBoxHeight)
        }
      } else {
        rootTransform = rootTransform.translate(rootX, rootY)
      }

      const combinedMatrix = svgTransform
        ? svgTransform.matrix.multiply(rootTransform)
        : rootTransform
      svgTransform = this.svg.createSVGTransformFromMatrix(combinedMatrix)

      // don't put the SVG itself into the stack, so start with the children of it
      const children = this.getNodeChildren(root)
      for (let i = children.length - 1; i >= 0; i--) {
        const child = children[i]
        if (child.tagName === 'symbol' || child.tagName === 'marker') {
          // symbols and marker can only be instantiated by specific elements
          continue
        }
        const childTransform = svgTransform
          ? this.getCombinedTransform(child, svgTransform)
          : this.getSvgTransform(child)
        stack.push({ element: child, transform: childTransform })
      }
    } else {
      stack.push({ element: root, transform: svgTransform })
    }

    while (stack.length > 0) {
      const { element, transform } = stack.pop()

      // maybe draw the element
      this.drawElement(element, transform)

      if (
        element.tagName === 'defs' ||
        element.tagName === 'symbol' ||
        element.tagName === 'marker' ||
        element.tagName === 'svg' ||
        element.tagName === 'clipPath'
      ) {
        // Defs are prepocessed separately.
        // Symbols and marker can only be instantiated by specific elements.
        // Don't traverse the SVG element itself. This is done by drawElement -> processRoot.
        // ClipPaths are not drawn and processed separately.
        continue
      }
      // process childs
      const children = this.getNodeChildren(element)
      for (let i = children.length - 1; i >= 0; i--) {
        const childElement = children[i]
        const newTransform = transform
          ? this.getCombinedTransform(childElement, transform)
          : this.getSvgTransform(childElement)
        stack.push({ element: childElement, transform: newTransform })
      }
    }
  }

  /**
   * Helper method to append the returned `SVGGElement` from
   * Rough.js when drawing in SVG mode.
   * @private
   * @param {SVGElement} element
   * @param {SVGElement} sketchElement
   */
  postProcessElement(element, sketchElement) {
    if (this.renderMode === RenderMode.SVG && sketchElement) {
      // maybe apply a clip-path
      const sketchClipPathId = element.getAttribute('data-sketchy-clip-path')
      if (sketchClipPathId) {
        sketchElement.setAttribute('clip-path', `url(#${sketchClipPathId})`)
      }

      if (this.pencilFilter && element.tagName !== 'text') {
        sketchElement.setAttribute('filter', 'url(#pencilTextureFilter)')
      }

      this.canvas.appendChild(sketchElement)
    }
  }

  /**
   * Combines the given transform with the element's transform.
   * @param {SVGElement} element
   * @param {SVGTransform} transform
   * @returns {SVGTransform}
   */
  getCombinedTransform(element, transform) {
    const elementTransform = this.getSvgTransform(element)
    if (elementTransform) {
      const elementTransformMatrix = elementTransform.matrix
      const combinedMatrix = transform.matrix.multiply(elementTransformMatrix)
      return this.svg.createSVGTransformFromMatrix(combinedMatrix)
    }
    return transform
  }

  /**
   * Returns the consolidated of the given element.
   * @private
   * @param {SVGElement} element
   * @returns {SVGTransform|null}
   */
  getSvgTransform(element) {
    if (element.transform && element.transform.baseVal.numberOfItems > 0) {
      return element.transform.baseVal.consolidate()
    }
    return null
  }

  /**
   * Applies the given svgTransform to the canvas context.
   * @private
   * @param {SVGTransform?} svgTransform
   * @param {SVGElement?} element The element to which the transform should be applied
   * when in SVG mode.
   */
  applyGlobalTransform(svgTransform, element) {
    if (svgTransform && svgTransform.matrix) {
      const matrix = svgTransform.matrix
      if (this.renderMode === RenderMode.CANVAS) {
        // IE11 doesn't support SVGMatrix as parameter for setTransform
        this.ctx.setTransform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f)
      } else if (this.renderMode === RenderMode.SVG && element) {
        if (element.transform.baseVal.numberOfItems > 0) {
          element.transform.baseVal.getItem(0).setMatrix(matrix)
        } else {
          element.transform.baseVal.appendItem(svgTransform)
        }
      }
    }
  }

  /**
   * Whether the given SVGTransform resembles an identity transform.
   * @private
   * @param {SVGTransform?} svgTransform
   * @returns {boolean} Whether the transform is an identity transform.
   *  Returns true if transform is undefined.
   */
  isIdentityTransform(svgTransform) {
    if (!svgTransform) {
      return true
    }
    const matrix = svgTransform.matrix
    return (
      !matrix ||
      (matrix.a === 1 &&
        matrix.b === 0 &&
        matrix.c === 0 &&
        matrix.d === 1 &&
        matrix.e === 0 &&
        matrix.f === 0)
    )
  }

  /**
   * Whether the given SVGTransform does not scale nor skew.
   * @private
   * @param {SVGTransform?} svgTransform
   * @returns {boolean} Whether the given SVGTransform does not scale nor skew.
   *  Returns true if transform is undefined.
   */
  isTranslationTransform(svgTransform) {
    if (!svgTransform) {
      return true
    }
    const matrix = svgTransform.matrix
    return !matrix || (matrix.a === 1 && matrix.b === 0 && matrix.c === 0 && matrix.d === 1)
  }

  /**
   * Stores elements with IDs for later use.
   * @private
   */
  collectElementsWithID() {
    this.idElements = {}
    const elementsWithID = Array.prototype.slice.apply(this.svg.querySelectorAll('*[id]'))
    for (const elt of elementsWithID) {
      const id = elt.getAttribute('id')
      if (id) {
        this.idElements[id] = elt
      }
    }
  }

  /**
   * Applies a given `SVGTransform` to the point.
   *
   * [a c e] [x] = (a*x + c*y + e)
   * [b d f] [y] = (b*x + d*y + f)
   * [0 0 1] [1] = (0 + 0 + 1)
   *
   * @private
   * @param {Point} point
   * @param {SVGTransform?} svgTransform
   * @return {Point}
   */
  applyMatrix(point, svgTransform) {
    if (!svgTransform) {
      return point
    }
    const matrix = svgTransform.matrix
    const x = matrix.a * point.x + matrix.c * point.y + matrix.e
    const y = matrix.b * point.x + matrix.d * point.y + matrix.f
    return new Point(x, y)
  }

  /**
   * Returns a random number in the given rande.
   * @private
   * @param {number} min
   * @param {number} max
   * @return {number}
   */
  getRandomNumber(min, max) {
    return Math.random() * (max - min) + min
  }

  /**
   * Returns the `offset` of an `SVGStopElement`.
   * @private
   * @param {SVGStopElement} stop
   * @return {number} stop percentage
   */
  getStopOffset(stop) {
    const offset = stop.getAttribute('offset')
    if (!offset) {
      return 0
    }
    if (offset.indexOf('%')) {
      return parseFloat(offset.substring(0, offset.length - 1))
    } else {
      return parseFloat(offset) * 100
    }
  }

  /**
   * Returns the `stop-color`of an `SVGStopElement`.
   * @private
   * @param {SVGStopElement} stop
   * @return {tinycolor}
   */
  getStopColor(stop) {
    let stopColorStr = stop.getAttribute('stop-color')
    if (!stopColorStr) {
      const style = stop.getAttribute('style')
      const match = /stop-color:\s?(.*);?/.exec(style)
      if (match.length > 1) {
        stopColorStr = match[1]
      }
    }
    return stopColorStr ? tinycolor(stopColorStr) : tinycolor('white')
  }

  /**
   * Converts an SVG gradient to a color by mixing all stop colors
   * with `tinycolor.mix`.
   * @private
   * @param {SVGLinearGradientElement | SVGRadialGradientElement} gradient
   * @param {number} opacity
   * @return {string}
   */
  gradientToColor(gradient, opacity) {
    const stops = Array.prototype.slice.apply(gradient.querySelectorAll('stop'))
    if (stops.length === 0) {
      return 'transparent'
    } else if (stops.length === 1) {
      const color = this.getStopColor(stop)
      color.setAlpha(opacity)
      return color.toString()
    } else {
      // combine the gradient
      const mixedColor = stops.reduce((acc, stop) => {
        const color = this.getStopColor(stop)
        const offset = this.getStopOffset(stop)
        return tinycolor.mix(acc, color, offset)
      })
      mixedColor.setAlpha(opacity)
      return mixedColor.toString()
    }
  }

  /**
   * Returns the id from the url string
   * @private
   * @param {string} url
   * @returns {string}
   */
  getIdFromUrl(url) {
    const result =
      /url\('#?(.*?)'\)/.exec(url) || /url\("#?(.*?)"\)/.exec(url) || /url\(#?(.*?)\)/.exec(url)
    if (result && result.length > 1) {
      return result[1]
    }
    return null
  }

  /**
   * Parses a `fill` url by looking in the SVG `defs` element.
   * When a gradient is found, it is converted to a color and stored
   * in the internal defs store for this url.
   * @private
   * @param {string} url
   * @param {number} opacity
   * @return {string}
   */
  parseFillUrl(url, opacity) {
    const id = this.getIdFromUrl(url)
    if (!id) {
      return 'transparent'
    }
    const fill = this.idElements[id]
    if (fill) {
      if (typeof fill === 'string') {
        // maybe it was already parsed and replaced with a color
        return fill
      } else {
        if (fill.tagName === 'linearGradient' || fill.tagName === 'radialGradient') {
          const color = this.gradientToColor(fill, opacity)
          this.idElements[id] = color
          return color
        }
      }
    }
  }

  /**
   * Converts SVG opacity attributes to a [0, 1] range.
   * @private
   * @param {SVGElement} element
   * @param {string} attribute
   */
  getOpacity(element, attribute) {
    const attr = getComputedStyle(element)[attribute] || element.getAttribute(attribute)
    if (attr) {
      if (attr.indexOf('%') !== -1) {
        return Math.min(1, Math.max(0, parseFloat(attr.substring(0, attr.length - 1)) / 100))
      }
      return Math.min(1, Math.max(0, parseFloat(attr)))
    }
    return 1
  }

  /**
   * Traverses the given elements hierarchy bottom-up to determine its effective
   * opacity attribute.
   * @private
   * @param {SVGElement} element
   * @param {number} currentOpacity
   * @param {object?} currentUseCtx Consider different DOM hierarchy for use elements
   * @returns {number}
   */
  getEffectiveElementOpacity(element, currentOpacity, currentUseCtx) {
    let attr
    if (!currentUseCtx) {
      attr = getComputedStyle(element)['opacity'] || element.getAttribute('opacity')
    } else {
      // use elements traverse a different parent-hierarchy, thus we cannot use getComputedStyle here
      attr = element.getAttribute('opacity')
    }
    if (attr) {
      let elementOpacity = 1
      if (attr.indexOf('%') !== -1) {
        elementOpacity = Math.min(
          1,
          Math.max(0, parseFloat(attr.substring(0, attr.length - 1)) / 100)
        )
      } else {
        elementOpacity = Math.min(1, Math.max(0, parseFloat(attr)))
      }
      // combine opacities
      currentOpacity *= elementOpacity
    }
    // traverse upwards to combine parent opacities as well
    let parent = element.parentElement

    const useCtx = currentUseCtx
    let nextCtx = useCtx

    if (useCtx && useCtx.referenced === element) {
      // switch context and traverse the use-element parent now
      parent = useCtx.root
      nextCtx = useCtx.parentContext
    }

    if (!parent || parent === this.$svg) {
      return currentOpacity
    }

    return this.getEffectiveElementOpacity(parent, currentOpacity, nextCtx)
  }

  /**
   * Returns the attribute value of an element under consideration
   * of inherited attributes from the `parentElement`.
   * @private
   * @param {SVGElement} element
   * @param {string} attributeName Name of the attribute to look up
   * @param {object?} currentUseCtx Consider different DOM hierarchy for use elements
   * @return {string|null} attribute value if it exists
   */
  getEffectiveAttribute(element, attributeName, currentUseCtx) {
    // getComputedStyle doesn't work for, e.g. <svg fill='rgba(...)'>
    let attr
    if (!currentUseCtx) {
      attr = getComputedStyle(element)[attributeName] || element.getAttribute(attributeName)
    } else {
      // use elements traverse a different parent-hierarchy, thus we cannot use getComputedStyle here
      attr = element.getAttribute(attributeName)
    }

    if (!attr) {
      let parent = element.parentElement

      const useCtx = currentUseCtx
      let nextCtx = useCtx

      if (useCtx && useCtx.referenced === element) {
        // switch context and traverse the use-element parent now
        parent = useCtx.root
        nextCtx = useCtx.parentContext
      }

      if (!parent || parent === this.$svg) {
        return null
      }
      return this.getEffectiveAttribute(parent, attributeName, nextCtx)
    }
    return attr
  }

  /**
   * Converts the given string to px unit. May be either a <length>
   * (https://developer.mozilla.org/de/docs/Web/SVG/Content_type#Length)
   * or a <percentage>
   * (https://developer.mozilla.org/de/docs/Web/SVG/Content_type#Percentage).
   * @private
   * @param {string} value
   * @returns {number} THe value in px unit
   */
  convertToPixelUnit(value) {
    // css-units fails for converting from unit-less to 'px' in IE11,
    // thus we only apply it to non-px values
    if (value.match(Svg2Roughjs.CONTAINS_UNIT_REGEXP) !== null) {
      return units.convert('px', value, this.$svg)
    }
    return parseFloat(value)
  }

  /**
   * Converts the effective style attributes of the given `SVGElement`
   * to a Rough.js config object that is used to draw the element with
   * Rough.js.
   * @private
   * @param {SVGElement} element
   * @param {SVGTransform?} svgTransform
   * @return {object} config for Rough.js drawing
   */
  parseStyleConfig(element, svgTransform) {
    const config = Object.assign({}, this.$roughConfig)

    // Scalefactor for certain style attributes. For lack of a better option here, use the determinant
    let scaleFactor = 1
    if (!this.isIdentityTransform(svgTransform)) {
      const m = svgTransform.matrix
      const det = m.a * m.d - m.c * m.b
      scaleFactor = Math.sqrt(det)
    }

    // incorporate the elements base opacity
    const elementOpacity = this.getEffectiveElementOpacity(element, 1, this.$useElementContext)

    const fill = this.getEffectiveAttribute(element, 'fill', this.$useElementContext) || 'black'
    const fillOpacity = elementOpacity * this.getOpacity(element, 'fill-opacity')
    if (fill) {
      if (fill.indexOf('url') !== -1) {
        config.fill = this.parseFillUrl(fill, fillOpacity)
      } else if (fill === 'none') {
        delete config.fill
      } else {
        const color = tinycolor(fill)
        color.setAlpha(fillOpacity)
        config.fill = color.toString()
      }
    }

    const stroke = this.getEffectiveAttribute(element, 'stroke', this.$useElementContext)
    const strokeOpacity = elementOpacity * this.getOpacity(element, 'stroke-opacity')
    if (stroke) {
      if (stroke.indexOf('url') !== -1) {
        config.stroke = this.parseFillUrl(fill, strokeOpacity)
      } else if (stroke === 'none') {
        config.stroke = 'none'
      } else {
        const color = tinycolor(stroke)
        color.setAlpha(strokeOpacity)
        config.stroke = color.toString()
      }
    } else {
      config.stroke = 'none'
    }

    const strokeWidth = this.getEffectiveAttribute(element, 'stroke-width', this.$useElementContext)
    if (strokeWidth) {
      // Convert to user space units (px)
      config.strokeWidth = this.convertToPixelUnit(strokeWidth) * scaleFactor
    } else {
      config.strokeWidth = 0
    }

    let strokeDashArray = this.getEffectiveAttribute(
      element,
      'stroke-dasharray',
      this.$useElementContext
    )
    if (strokeDashArray && strokeDashArray !== 'none') {
      strokeDashArray = strokeDashArray
        .split(/[\s,]+/)
        .filter(entry => entry.length > 0)
        // make sure that dashes/dots are at least somewhat visible
        .map(dash => Math.max(0.5, this.convertToPixelUnit(dash) * scaleFactor))
      config.strokeLineDash = strokeDashArray
    }

    let strokeDashOffset = this.getEffectiveAttribute(
      element,
      'stroke-dashoffset',
      this.$useElementContext
    )
    if (strokeDashOffset) {
      strokeDashOffset = this.convertToPixelUnit(strokeDashOffset)
      config.strokeLineDashOffset = strokeDashOffset * scaleFactor
    }

    // unstroked but filled shapes look weird, so always apply a stroke if we fill something
    if (config.fill && config.stroke === 'none') {
      config.stroke = config.fill
      config.strokeWidth = 1
    }

    // nested paths should be filled twice, see
    // https://github.com/rough-stuff/rough/issues/158
    // however, fill-rule is still problematic, see
    // https://github.com/rough-stuff/rough/issues/131
    if (typeof config.combineNestedSvgPaths === 'undefined') {
      config.combineNestedSvgPaths = true
    }

    if (this.randomize) {
      // Rough.js default is 0.5 * strokeWidth
      config.fillWeight = this.getRandomNumber(0.5, 3)
      // Rough.js default is -41deg
      config.hachureAngle = this.getRandomNumber(-30, -50)
      // Rough.js default is 4 * strokeWidth
      config.hachureGap = this.getRandomNumber(3, 5)
      // randomize double stroke effect if not explicitly set through user config
      if (typeof config.disableMultiStroke === 'undefined') {
        config.disableMultiStroke = Math.random() > 0.3
      }
    }

    return config
  }

  /**
   * @private
   * @param {SVGSVGElement}
   * @returns {SVGDefsElement}
   */
  getDefsElement(svgElement) {
    let outputDefs = svgElement.querySelector('defs')
    if (!outputDefs) {
      outputDefs = document.createElementNS('http://www.w3.org/2000/svg', 'defs')
      if (svgElement.childElementCount > 0) {
        svgElement.insertBefore(outputDefs, svgElement.firstElementChild)
      } else {
        svgElement.appendChild(outputDefs)
      }
    }
    return outputDefs
  }

  /**
   * Applies the clip-path to the CanvasContext.
   * @private
   * @param {SVGElement} owner
   * @param {string} clipPathAttr
   * @param {SVGTransform?} svgTransform
   */
  applyClipPath(owner, clipPathAttr, svgTransform) {
    const id = this.getIdFromUrl(clipPathAttr)
    if (!id) {
      return
    }

    const clipPath = this.idElements[id]
    if (!clipPath) {
      return
    }

    // TODO clipPath: consider clipPathUnits
    let clipContainer
    if (this.renderMode === RenderMode.CANVAS) {
      // for a canvas, we just apply a 'ctx.clip()' path
      this.ctx.beginPath()
    } else {
      // for SVG output we create clipPath defs
      let targetDefs = this.getDefsElement(this.canvas)
      // unfortunately, we cannot reuse clip-paths due to the 'global transform' approach
      const sketchClipPathId = `${id}_${targetDefs.childElementCount}`
      clipContainer = document.createElementNS('http://www.w3.org/2000/svg', 'clipPath')
      clipContainer.id = sketchClipPathId
      // remember the new id by storing it on the owner element
      owner.setAttribute('data-sketchy-clip-path', sketchClipPathId)
      targetDefs.appendChild(clipContainer)
    }

    // traverse clip-path elements in DFS
    const stack = []
    const children = this.getNodeChildren(clipPath)
    for (let i = children.length - 1; i >= 0; i--) {
      const childElement = children[i]
      const childTransform = svgTransform
        ? this.getCombinedTransform(childElement, svgTransform)
        : this.getSvgTransform(childElement)
      stack.push({ element: childElement, transform: childTransform })
    }

    while (stack.length > 0) {
      const { element, transform } = stack.pop()

      this.applyElementClip(element, clipContainer, transform)

      if (
        element.tagName === 'defs' ||
        element.tagName === 'svg' ||
        element.tagName === 'clipPath' ||
        element.tagName === 'text'
      ) {
        // some elements are ignored on clippaths
        continue
      }
      // process childs
      const children = this.getNodeChildren(element)
      for (let i = children.length - 1; i >= 0; i--) {
        const childElement = children[i]
        const childTransform = transform
          ? this.getCombinedTransform(childElement, transform)
          : this.getSvgTransform(childElement)
        stack.push({ element: childElement, transform: childTransform })
      }
    }

    if (this.renderMode === RenderMode.CANVAS) {
      this.ctx.clip()
    }
  }

  /**
   * Applies the element as clip to the CanvasContext.
   * @private
   * @param {SVGElement} element
   * @param {SVGClipPathElement} container
   * @param {SVGTransform?} svgTransform
   */
  applyElementClip(element, container, svgTransform) {
    switch (element.tagName) {
      case 'rect':
        this.applyRectClip(element, container, svgTransform)
        break
      case 'circle':
        this.applyCircleClip(element, container, svgTransform)
        break
      case 'ellipse':
        this.applyEllipseClip(element, container, svgTransform)
        break
      case 'polygon':
        this.applyPolygonClip(element, container, svgTransform)
        break
      // TODO clipPath: more elements
    }
  }

  /**
   * @private
   * @param {SVGElement} element
   */
  isHidden(element) {
    const style = element.style
    if (!style) {
      return false
    }
    return style.display === 'none' || style.visibility === 'hidden'
  }

  /**
   * The main switch to delegate drawing of `SVGElement`s
   * to different subroutines.
   * @private
   * @param {SVGElement} element
   * @param {SVGTransform} svgTransform
   */
  drawElement(element, svgTransform) {
    if (this.isHidden(element)) {
      // just skip hidden elements
      return
    }

    // possibly apply a clip on the canvas before drawing on it
    const clipPath = element.getAttribute('clip-path')
    if (clipPath) {
      if (this.renderMode === RenderMode.CANVAS) {
        this.ctx.save()
      }
      this.applyClipPath(element, clipPath, svgTransform)
    }

    switch (element.tagName) {
      case 'svg':
      case 'symbol':
        this.drawRoot(element, svgTransform)
        break
      case 'rect':
        this.drawRect(element, svgTransform)
        break
      case 'path':
        this.drawPath(element, svgTransform)
        break
      case 'use':
        this.drawUse(element, svgTransform)
        break
      case 'line':
        this.drawLine(element, svgTransform)
        break
      case 'circle':
        this.drawCircle(element, svgTransform)
        break
      case 'ellipse':
        this.drawEllipse(element, svgTransform)
        break
      case 'polyline':
        this.drawPolyline(element, svgTransform)
        break
      case 'polygon':
        this.drawPolygon(element, svgTransform)
        break
      case 'text':
        this.drawText(element, svgTransform)
        break
      case 'image':
        this.drawImage(element, svgTransform)
        break
    }

    // re-set the clip for the next element
    if (clipPath) {
      if (this.renderMode === RenderMode.CANVAS) {
        this.ctx.restore()
      }
    }
  }

  /**
   * @private
   * @param {SVGPathElement|SVGLineElement|SVGPolylineElement|SVGPolygonElement} element
   * @param {Point[]} points Array of coordinates
   * @param {SVGTransform?}
   */
  drawMarkers(element, points, svgTransform) {
    if (points.length === 0) {
      return
    }

    // consider scaled coordinate system for markerWidth/markerHeight
    const markerUnits = element.getAttribute('markerUnits')
    let scaleFactor = 1
    if (!markerUnits || markerUnits === 'strokeWidth') {
      const strokeWidth = this.getEffectiveAttribute(element, 'stroke-width', null)
      if (strokeWidth) {
        scaleFactor = this.convertToPixelUnit(strokeWidth)
      }
    }

    // start marker
    const markerStartId = this.getIdFromUrl(element.getAttribute('marker-start'))
    const markerStartElement = markerStartId ? this.idElements[markerStartId] : null
    if (markerStartElement) {
      let angle = markerStartElement.orientAngle.baseVal.value
      if (points.length > 1) {
        const orientAttr = markerStartElement.getAttribute('orient')
        if (orientAttr === 'auto' || orientAttr === 'auto-start-reverse') {
          const autoAngle = this.getAngle(points[0], points[1])
          angle = orientAttr === 'auto' ? autoAngle : autoAngle + 180
        }
      }

      const location = points[0]
      const matrix = this.svg
        .createSVGMatrix()
        .translate(location.x, location.y)
        .rotate(angle)
        .scale(scaleFactor)

      const combinedMatrix = svgTransform ? svgTransform.matrix.multiply(matrix) : matrix
      const markerTransform = this.svg.createSVGTransformFromMatrix(combinedMatrix)

      this.processRoot(markerStartElement, markerTransform)
    }

    // end marker
    const markerEndId = this.getIdFromUrl(element.getAttribute('marker-end'))
    const markerEndElement = markerEndId ? this.idElements[markerEndId] : null
    if (markerEndElement) {
      let angle = markerEndElement.orientAngle.baseVal.value
      if (points.length > 1) {
        const orientAttr = markerEndElement.getAttribute('orient')
        if (orientAttr === 'auto' || orientAttr === 'auto-start-reverse') {
          angle = this.getAngle(points[points.length - 2], points[points.length - 1])
        }
      }

      const location = points[points.length - 1]
      const matrix = this.svg
        .createSVGMatrix()
        .translate(location.x, location.y)
        .rotate(angle)
        .scale(scaleFactor)

      const combinedMatrix = svgTransform ? svgTransform.matrix.multiply(matrix) : matrix
      const markerTransform = this.svg.createSVGTransformFromMatrix(combinedMatrix)

      this.processRoot(markerEndElement, markerTransform)
    }

    // mid marker(s)
    const markerMidId = this.getIdFromUrl(element.getAttribute('marker-mid'))
    const markerMidElement = markerMidId ? this.idElements[markerMidId] : null
    if (markerMidElement && points.length > 2) {
      for (let i = 0; i < points.length; i++) {
        const loc = points[i]
        if (i === 0 || i === points.length - 1) {
          // mid markers are not drawn on first or last point
          continue
        }

        let angle = markerMidElement.orientAngle.baseVal.value
        const orientAttr = markerMidElement.getAttribute('orient')
        if (orientAttr === 'auto' || orientAttr === 'auto-start-reverse') {
          const prevPt = points[i - 1]
          const nextPt = points[i + 1]
          // https://www.w3.org/TR/SVG11/painting.html#OrientAttribute
          // use angle bisector of incoming and outgoing angle
          const inAngle = this.getAngle(prevPt, loc)
          const outAngle = this.getAngle(loc, nextPt)
          const reverse = nextPt.x < loc.x ? 180 : 0
          angle = (inAngle + outAngle) / 2 + reverse
        }

        const matrix = this.svg
          .createSVGMatrix()
          .translate(loc.x, loc.y)
          .rotate(angle)
          .scale(scaleFactor)

        const combinedMatrix = svgTransform ? svgTransform.matrix.multiply(matrix) : matrix
        const markerTransform = this.svg.createSVGTransformFromMatrix(combinedMatrix)

        this.processRoot(markerMidElement, markerTransform)
      }
    }
  }

  /**
   * The angle in degree of the line defined by the given points.
   * @private
   * @param {Point} p0
   * @param {Point} p1
   * @returns {number}
   */
  getAngle(p0, p1) {
    return Math.atan2(p1.y - p0.y, p1.x - p0.x) * (180 / Math.PI)
  }

  /**
   * @private
   * @param {SVGPolylineElement} polyline
   * @param {SVGTransform?} svgTransform
   */
  drawPolyline(polyline, svgTransform) {
    const points = this.getPointsArray(polyline)
    const transformed = points.map(p => {
      const pt = this.applyMatrix(p, svgTransform)
      return [pt.x, pt.y]
    })
    const style = this.parseStyleConfig(polyline, svgTransform)
    if (style.fill && style.fill !== 'none') {
      const fillStyle = Object.assign({}, style)
      fillStyle.stroke = 'none'
      this.postProcessElement(polyline, this.rc.polygon(transformed, fillStyle))
    }
    this.postProcessElement(polyline, this.rc.linearPath(transformed, style))

    this.drawMarkers(polyline, points, svgTransform)
  }

  /**
   * @private
   * @param {SVGPolygonElement | SVGPolylineElement} element
   * @returns {Array<Point>}
   */
  getPointsArray(element) {
    const pointsAttr = element.getAttribute('points')
    if (!pointsAttr) {
      return []
    }

    let coordinateRegexp
    if (pointsAttr.indexOf(' ') > 0) {
      // just assume that the coordinates (or pairs) are separated with space
      coordinateRegexp = /\s+/g
    } else {
      // there are no spaces, so assume comma separators
      coordinateRegexp = /,/g
    }

    const pointList = pointsAttr.split(coordinateRegexp)
    const points = []
    for (let i = 0; i < pointList.length; i++) {
      const currentEntry = pointList[i]
      const coordinates = currentEntry.split(',')
      if (coordinates.length === 2) {
        points.push(new Point(parseFloat(coordinates[0]), parseFloat(coordinates[1])))
      } else {
        // space as separators, take next entry as y coordinate
        const next = i + 1
        if (next < pointList.length) {
          points.push(new Point(parseFloat(currentEntry), parseFloat(pointList[next])))
          // skip the next entry
          i = next
        }
      }
    }
    return points
  }

  /**
   * @private
   * @param {SVGPolygonElement} polygon
   * @param {SVGClipPathElement?} container
   * @param {SVGTransform?} svgTransform
   */
  applyPolygonClip(polygon, container, svgTransform) {
    if (this.renderMode === RenderMode.CANVAS) {
      const points = this.getPointsArray(polygon)
      // in the clip case, we can actually transform the entire
      // canvas without distorting the hand-drawn style
      if (points.length > 0) {
        this.ctx.save()
        this.applyGlobalTransform(svgTransform)
        const startPt = points[0]
        this.ctx.moveTo(startPt.x, startPt.y)
        for (let i = 1; i < points.length; i++) {
          const pt = points[i]
          this.ctx.lineTo(pt.x, pt.y)
        }
        this.ctx.closePath()
        this.ctx.restore()
      }
    } else {
      const clip = document.createElementNS('http://www.w3.org/2000/svg', 'polygon')
      clip.setAttribute('points', polygon.getAttribute('points'))
      this.applyGlobalTransform(svgTransform, clip)
      container.appendChild(clip)
    }
  }

  /**
   * @private
   * @param {SVGPolygonElement} polygon
   * @param {SVGTransform?} svgTransform
   */
  drawPolygon(polygon, svgTransform) {
    const points = this.getPointsArray(polygon)

    const transformed = points.map(p => {
      const pt = this.applyMatrix(p, svgTransform)
      return [pt.x, pt.y]
    })

    this.postProcessElement(
      polygon,
      this.rc.polygon(transformed, this.parseStyleConfig(polygon, svgTransform))
    )

    // https://www.w3.org/TR/SVG11/painting.html#MarkerProperties
    // Note that for a ‘path’ element which ends with a closed sub-path,
    // the last vertex is the same as the initial vertex on the given
    // sub-path (same applies to polygon).
    if (points.length > 0) {
      points.push(points[0])
      this.drawMarkers(polygon, points, svgTransform)
    }
  }

  /**
   * @private
   * @param {SVGEllipseElement} ellipse
   * @param {SVGClipPathElement} container
   * @param {SVGTransform?} svgTransform
   */
  applyEllipseClip(ellipse, container, svgTransform) {
    const cx = ellipse.cx.baseVal.value
    const cy = ellipse.cy.baseVal.value
    const rx = ellipse.rx.baseVal.value
    const ry = ellipse.ry.baseVal.value

    if (rx === 0 || ry === 0) {
      // zero-radius ellipse is not rendered
      return
    }

    if (this.renderMode === RenderMode.CANVAS) {
      // in the clip case, we can actually transform the entire
      // canvas without distorting the hand-drawn style
      this.ctx.save()
      this.applyGlobalTransform(svgTransform)
      this.ctx.ellipse(cx, cy, rx, ry, 0, 0, 2 * Math.PI)
      this.ctx.restore()
    } else {
      const clip = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse')
      clip.cx.baseVal.value = cx
      clip.cy.baseVal.value = cy
      clip.rx.baseVal.value = rx
      clip.ry.baseVal.value = ry
      this.applyGlobalTransform(svgTransform, clip)
      container.appendChild(clip)
    }
  }

  /**
   * @private
   * @param {SVGEllipseElement} ellipse
   * @param {SVGTransform?} svgTransform
   */
  drawEllipse(ellipse, svgTransform) {
    const cx = ellipse.cx.baseVal.value
    const cy = ellipse.cy.baseVal.value
    const rx = ellipse.rx.baseVal.value
    const ry = ellipse.ry.baseVal.value

    if (rx === 0 || ry === 0) {
      // zero-radius ellipse is not rendered
      return
    }

    let result
    if (this.isIdentityTransform(svgTransform) || this.isTranslationTransform(svgTransform)) {
      // Simple case, there's no transform and we can use the ellipse command
      const center = this.applyMatrix(new Point(cx, cy), svgTransform)
      // transform a point on the ellipse to get the transformed radius
      const radiusPoint = this.applyMatrix(new Point(cx + rx, cy + ry), svgTransform)
      const transformedWidth = 2 * (radiusPoint.x - center.x)
      const transformedHeight = 2 * (radiusPoint.y - center.y)
      result = this.rc.ellipse(
        center.x,
        center.y,
        transformedWidth,
        transformedHeight,
        this.parseStyleConfig(ellipse, svgTransform)
      )
    } else {
      // in other cases we need to construct the path manually.
      const factor = (4 / 3) * (Math.sqrt(2) - 1)
      const p1 = this.applyMatrix(new Point(cx + rx, cy), svgTransform)
      const p2 = this.applyMatrix(new Point(cx, cy + ry), svgTransform)
      const p3 = this.applyMatrix(new Point(cx - rx, cy), svgTransform)
      const p4 = this.applyMatrix(new Point(cx, cy - ry), svgTransform)
      const c1 = this.applyMatrix(new Point(cx + rx, cy + factor * ry), svgTransform)
      const c2 = this.applyMatrix(new Point(cx + factor * rx, cy + ry), svgTransform)
      const c4 = this.applyMatrix(new Point(cx - rx, cy + factor * ry), svgTransform)
      const c6 = this.applyMatrix(new Point(cx - factor * rx, cy - ry), svgTransform)
      const c8 = this.applyMatrix(new Point(cx + rx, cy - factor * ry), svgTransform)
      const path = `M ${p1} C ${c1} ${c2} ${p2} S ${c4} ${p3} S ${c6} ${p4} S ${c8} ${p1}z`
      result = this.rc.path(path, this.parseStyleConfig(ellipse, svgTransform))
    }

    this.postProcessElement(ellipse, result)
  }
  /**
   * @private
   * @param {SVGCircleElement} circle
   * @param {SVGClipPathElement} container
   * @param {SVGTransform?} svgTransform
   */
  applyCircleClip(circle, container, svgTransform) {
    const cx = circle.cx.baseVal.value
    const cy = circle.cy.baseVal.value
    const r = circle.r.baseVal.value

    if (r === 0) {
      // zero-radius circle is not rendered
      return
    }

    if (this.renderMode === RenderMode.CANVAS) {
      // in the clip case, we can actually transform the entire
      // canvas without distorting the hand-drawn style
      this.ctx.save()
      this.applyGlobalTransform(svgTransform)
      this.ctx.ellipse(cx, cy, r, r, 0, 0, 2 * Math.PI)
      this.ctx.restore()
    } else {
      const clip = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
      clip.cx.baseVal.value = cx
      clip.cy.baseVal.value = cy
      clip.r.baseVal.value = r
      this.applyGlobalTransform(svgTransform, clip)
      container.appendChild(clip)
    }
  }

  /**
   * @private
   * @param {SVGCircleElement} circle
   * @param {SVGTransform?} svgTransform
   */
  drawCircle(circle, svgTransform) {
    const cx = circle.cx.baseVal.value
    const cy = circle.cy.baseVal.value
    const r = circle.r.baseVal.value

    if (r === 0) {
      // zero-radius circle is not rendered
      return
    }

    const center = this.applyMatrix(new Point(cx, cy), svgTransform)

    let result
    if (this.isIdentityTransform(svgTransform) || this.isTranslationTransform(svgTransform)) {
      // transform a point on the ellipse to get the transformed radius
      const radiusPoint = this.applyMatrix(new Point(cx + r, cy + r), svgTransform)
      const transformedWidth = 2 * (radiusPoint.x - center.x)
      result = this.rc.circle(
        center.x,
        center.y,
        transformedWidth,
        this.parseStyleConfig(circle, svgTransform)
      )
    } else {
      // in other cases we need to construct the path manually.
      const factor = (4 / 3) * (Math.sqrt(2) - 1)
      const p1 = this.applyMatrix(new Point(cx + r, cy), svgTransform)
      const p2 = this.applyMatrix(new Point(cx, cy + r), svgTransform)
      const p3 = this.applyMatrix(new Point(cx - r, cy), svgTransform)
      const p4 = this.applyMatrix(new Point(cx, cy - r), svgTransform)
      const c1 = this.applyMatrix(new Point(cx + r, cy + factor * r), svgTransform)
      const c2 = this.applyMatrix(new Point(cx + factor * r, cy + r), svgTransform)
      const c4 = this.applyMatrix(new Point(cx - r, cy + factor * r), svgTransform)
      const c6 = this.applyMatrix(new Point(cx - factor * r, cy - r), svgTransform)
      const c8 = this.applyMatrix(new Point(cx + r, cy - factor * r), svgTransform)
      const path = `M ${p1} C ${c1} ${c2} ${p2} S ${c4} ${p3} S ${c6} ${p4} S ${c8} ${p1}z`
      result = this.rc.path(path, this.parseStyleConfig(circle, svgTransform))
    }

    this.postProcessElement(circle, result)
  }

  /**
   * @private
   * @param {SVGLineElement} line
   * @param {SVGTransform?} svgTransform
   */
  drawLine(line, svgTransform) {
    const p1 = new Point(line.x1.baseVal.value, line.y1.baseVal.value)
    const tp1 = this.applyMatrix(p1, svgTransform)
    const p2 = new Point(line.x2.baseVal.value, line.y2.baseVal.value)
    const tp2 = this.applyMatrix(p2, svgTransform)

    if (tp1.x === tp2.x && tp1.y === tp2.y) {
      // zero-length line is not rendered
      return
    }

    this.postProcessElement(
      line,
      this.rc.line(tp1.x, tp1.y, tp2.x, tp2.y, this.parseStyleConfig(line, svgTransform))
    )

    this.drawMarkers(line, [p1, p2], svgTransform)
  }

  /**
   * @private
   * @param {SVGSVGElement | SVGSymbolElement} element
   * @param {SVGTransform?} svgTransform
   */
  drawRoot(element, svgTransform) {
    let width = parseFloat(element.getAttribute('width'))
    let height = parseFloat(element.getAttribute('height'))
    if (isNaN(width) || isNaN(height)) {
      // use only if both are set
      width = height = null
    }
    this.processRoot(element, svgTransform, width, height)
  }

  /**
   * @private
   * @param {SVGUseElement} use
   * @param {SVGTransform?} svgTransform
   */
  drawUse(use, svgTransform) {
    let href = use.href.baseVal
    if (href.startsWith('#')) {
      href = href.substring(1)
    }
    const defElement = this.idElements[href]
    if (defElement) {
      let useWidth, useHeight
      if (use.getAttribute('width') && use.getAttribute('height')) {
        // Use elements can overwrite the width which is important if it is a nested SVG
        useWidth = use.width.baseVal.value
        useHeight = use.height.baseVal.value
      }
      // We need to account for x and y attributes as well. Those change where the element is drawn.
      // We can simply change the transform to include that.
      const x = use.x.baseVal.value
      const y = use.y.baseVal.value
      let matrix = this.svg.createSVGMatrix().translate(x, y)
      matrix = svgTransform ? svgTransform.matrix.multiply(matrix) : matrix

      // the defsElement itself might have a transform that needs to be incorporated
      const elementTransform = this.svg.createSVGTransformFromMatrix(matrix)

      // use elements must be processed in their context, particularly regarding
      // the styling of them
      if (!this.$useElementContext) {
        this.$useElementContext = { root: use, referenced: defElement }
      } else {
        const newContext = {
          root: use,
          referenced: defElement,
          parentContext: Object.assign({}, this.$useElementContext)
        }
        this.$useElementContext = newContext
      }

      // draw the referenced element
      this.processRoot(
        defElement,
        this.getCombinedTransform(defElement, elementTransform),
        useWidth,
        useHeight
      )

      // restore default context
      if (this.$useElementContext.parentContext) {
        this.$useElementContext = this.$useElementContext.parentContext
      } else {
        this.$useElementContext = null
      }
    }
  }

  /**
   * @private
   * @param {SVGPathElement} path
   * @param {SVGTransform?} svgTransform
   */
  drawPath(path, svgTransform) {
    const dataAttrs = path.getAttribute('d')
    const pathData =
      // Parse path data and convert to absolute coordinates
      new SVGPathData(dataAttrs)
        .toAbs()
        // Normalize H and V to L commands - those cannot work with how we draw transformed paths otherwise
        .transform(SVGPathDataTransformer.NORMALIZE_HVZ())
        // Normalize S and T to Q and C commands - Rough.js has a bug with T where it expects 4 parameters instead of 2
        .transform(SVGPathDataTransformer.NORMALIZE_ST())

    // If there's a transform, transform the whole path accordingly
    const transformedPathData = new SVGPathData(
      // clone the commands, we might need them untransformed for markers
      pathData.commands.map(cmd => Object.assign({}, cmd))
    )
    if (svgTransform) {
      transformedPathData.transform(
        SVGPathDataTransformer.MATRIX(
          svgTransform.matrix.a,
          svgTransform.matrix.b,
          svgTransform.matrix.c,
          svgTransform.matrix.d,
          svgTransform.matrix.e,
          svgTransform.matrix.f
        )
      )
    }

    const encodedPathData = encodeSVGPath(transformedPathData.commands)
    if (encodedPathData.indexOf('undefined') !== -1) {
      // DEBUG STUFF
      console.error('broken path data')
      debugger
      return
    }

    this.postProcessElement(
      path,
      this.rc.path(encodedPathData, this.parseStyleConfig(path, svgTransform))
    )

    // https://www.w3.org/TR/SVG11/painting.html#MarkerProperties
    // Note that for a ‘path’ element which ends with a closed sub-path,
    // the last vertex is the same as the initial vertex on the given
    // sub-path (same applies to polygon).
    const points = []
    let currentSubPathBegin
    pathData.commands.forEach(cmd => {
      switch (cmd.type) {
        case SVGPathData.MOVE_TO:
          const p = new Point(cmd.x, cmd.y)
          points.push(p)
          // each moveto starts a new subpath
          currentSubPathBegin = p
          break
        case SVGPathData.LINE_TO:
        case SVGPathData.QUAD_TO:
        case SVGPathData.SMOOTH_QUAD_TO:
        case SVGPathData.CURVE_TO:
        case SVGPathData.SMOOTH_CURVE_TO:
        case SVGPathData.ARC:
          points.push(new Point(cmd.x, cmd.y))
          break
        case SVGPathData.HORIZ_LINE_TO:
          points.push(new Point(cmd.x, 0))
          break
        case SVGPathData.VERT_LINE_TO:
          points.push(new Point(0, cmd.y))
          break
        case SVGPathData.CLOSE_PATH:
          if (currentSubPathBegin) {
            points.push(currentSubPathBegin)
          }
          break
      }
    })
    this.drawMarkers(path, points, svgTransform)
  }

  /**
   * @private
   * @param {SVGRectElement} rect
   * @param {SVGClipPathElement} container
   * @param {SVGTransform?} svgTransform
   */
  applyRectClip(rect, container, svgTransform) {
    const x = rect.x.baseVal.value
    const y = rect.y.baseVal.value
    const width = rect.width.baseVal.value
    const height = rect.height.baseVal.value

    if (width === 0 || height === 0) {
      // zero-width or zero-height rect will not be rendered
      return
    }

    let rx = rect.hasAttribute('rx') ? rect.rx.baseVal.value : null
    let ry = rect.hasAttribute('ry') ? rect.ry.baseVal.value : null

    // in the clip case, we can actually transform the entire
    // canvas without distorting the hand-drawn style
    if (this.renderMode === RenderMode.CANVAS) {
      this.ctx.save()
      this.applyGlobalTransform(svgTransform)
      if (!rx && !ry) {
        this.ctx.rect(x, y, width, height)
      } else {
        // Construct path for the rounded rectangle
        const factor = (4 / 3) * (Math.sqrt(2) - 1)
        this.ctx.moveTo(x + rx, y)
        this.ctx.lineTo(x + width - rx, y)
        this.ctx.bezierCurveTo(
          x + width - rx + factor * rx,
          y,
          x + width,
          y + factor * ry,
          x + width,
          y + ry
        )
        this.ctx.lineTo(x + width, y + height - ry)
        this.ctx.bezierCurveTo(
          x + width,
          y + height - ry + factor * ry,
          x + width - factor * rx,
          y + height,
          x + width - rx,
          y + height
        )
        this.ctx.lineTo(x + rx, y + height)
        this.ctx.bezierCurveTo(
          x + rx - factor * rx,
          y + height,
          x,
          y + height - factor * ry,
          x,
          y + height - ry
        )
        this.ctx.lineTo(x, y + ry)
        this.ctx.bezierCurveTo(x, y + factor * ry, x + factor * rx, y, x + rx, y)
        this.ctx.closePath()
      }
      this.ctx.restore()
    } else {
      const clip = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
      clip.x.baseVal.value = x
      clip.y.baseVal.value = y
      clip.width.baseVal.value = width
      clip.height.baseVal.value = height
      if (rx) {
        clip.rx.baseVal.value = rx
      }
      if (ry) {
        clip.ry.baseVal.value = ry
      }
      this.applyGlobalTransform(svgTransform, clip)
      container.appendChild(clip)
    }
  }

  /**
   * @private
   * @param {SVGRectElement} rect
   * @param {SVGTransform?} svgTransform
   */
  drawRect(rect, svgTransform) {
    const x = rect.x.baseVal.value
    const y = rect.y.baseVal.value
    const width = rect.width.baseVal.value
    const height = rect.height.baseVal.value

    if (width === 0 || height === 0) {
      // zero-width or zero-height rect will not be rendered
      return
    }

    let rx = rect.hasAttribute('rx') ? rect.rx.baseVal.value : null
    let ry = rect.hasAttribute('ry') ? rect.ry.baseVal.value : null
    if (rx || ry) {
      // Negative values are an error and result in the default value
      rx = rx < 0 ? 0 : rx
      ry = ry < 0 ? 0 : ry
      // If only one of the two values is specified, the other has the same value
      rx = rx === null ? ry : rx
      ry = ry === null ? rx : ry
      // Clamp both values to half their sides' lengths
      rx = Math.min(rx, width / 2)
      ry = Math.min(ry, height / 2)
    }

    if (
      (this.isIdentityTransform(svgTransform) || this.isTranslationTransform(svgTransform)) &&
      !rx &&
      !ry
    ) {
      // Simple case; just a rectangle
      const p1 = this.applyMatrix(new Point(x, y), svgTransform)
      const p2 = this.applyMatrix(new Point(x + width, y + height), svgTransform)
      const transformedWidth = p2.x - p1.x
      const transformedHeight = p2.y - p1.y
      this.postProcessElement(
        rect,
        this.rc.rectangle(
          p1.x,
          p1.y,
          transformedWidth,
          transformedHeight,
          this.parseStyleConfig(rect, svgTransform)
        )
      )
    } else {
      let path = ''
      if (!rx && !ry) {
        const p1 = this.applyMatrix(new Point(x, y), svgTransform)
        const p2 = this.applyMatrix(new Point(x + width, y), svgTransform)
        const p3 = this.applyMatrix(new Point(x + width, y + height), svgTransform)
        const p4 = this.applyMatrix(new Point(x, y + height), svgTransform)
        // No rounding, so just construct the respective path as a simple polygon
        path += `M ${p1}`
        path += `L ${p2}`
        path += `L ${p3}`
        path += `L ${p4}`
        path += `z`
      } else {
        const factor = (4 / 3) * (Math.sqrt(2) - 1)

        // Construct path for the rounded rectangle
        // perform an absolute moveto operation to location (x+rx,y), where x is the value of the ‘rect’ element's ‘x’ attribute converted to user space, rx is the effective value of the ‘rx’ attribute converted to user space and y is the value of the ‘y’ attribute converted to user space
        const p1 = this.applyMatrix(new Point(x + rx, y), svgTransform)
        path += `M ${p1}`
        // perform an absolute horizontal lineto operation to location (x+width-rx,y), where width is the ‘rect’ element's ‘width’ attribute converted to user space
        const p2 = this.applyMatrix(new Point(x + width - rx, y), svgTransform)
        path += `L ${p2}`
        // perform an absolute elliptical arc operation to coordinate (x+width,y+ry), where the effective values for the ‘rx’ and ‘ry’ attributes on the ‘rect’ element converted to user space are used as the rx and ry attributes on the elliptical arc command, respectively, the x-axis-rotation is set to zero, the large-arc-flag is set to zero, and the sweep-flag is set to one
        const p3c1 = this.applyMatrix(new Point(x + width - rx + factor * rx, y), svgTransform)
        const p3c2 = this.applyMatrix(new Point(x + width, y + factor * ry), svgTransform)
        const p3 = this.applyMatrix(new Point(x + width, y + ry), svgTransform)
        path += `C ${p3c1} ${p3c2} ${p3}` // We cannot use the arc command, since we no longer draw in the expected coordinates. So approximate everything with lines and béziers
        // perform a absolute vertical lineto to location (x+width,y+height-ry), where height is the ‘rect’ element's ‘height’ attribute converted to user space
        const p4 = this.applyMatrix(new Point(x + width, y + height - ry), svgTransform)
        path += `L ${p4}`
        // perform an absolute elliptical arc operation to coordinate (x+width-rx,y+height)
        const p5c1 = this.applyMatrix(
          new Point(x + width, y + height - ry + factor * ry),
          svgTransform
        )
        const p5c2 = this.applyMatrix(new Point(x + width - factor * rx, y + height), svgTransform)
        const p5 = this.applyMatrix(new Point(x + width - rx, y + height), svgTransform)
        path += `C ${p5c1} ${p5c2} ${p5}`
        // perform an absolute horizontal lineto to location (x+rx,y+height)
        const p6 = this.applyMatrix(new Point(x + rx, y + height), svgTransform)
        path += `L ${p6}`
        // perform an absolute elliptical arc operation to coordinate (x,y+height-ry)
        const p7c1 = this.applyMatrix(new Point(x + rx - factor * rx, y + height), svgTransform)
        const p7c2 = this.applyMatrix(new Point(x, y + height - factor * ry), svgTransform)
        const p7 = this.applyMatrix(new Point(x, y + height - ry), svgTransform)
        path += `C ${p7c1} ${p7c2} ${p7}`
        // perform an absolute absolute vertical lineto to location (x,y+ry)
        const p8 = this.applyMatrix(new Point(x, y + ry), svgTransform)
        path += `L ${p8}`
        // perform an absolute elliptical arc operation to coordinate (x+rx,y)
        const p9c1 = this.applyMatrix(new Point(x, y + factor * ry), svgTransform)
        const p9c2 = this.applyMatrix(new Point(x + factor * rx, y), svgTransform)
        path += `C ${p9c1} ${p9c2} ${p1}`
        path += 'z'
      }

      // must use square line cap here so it looks like a rectangle. Default seems to be butt.
      if (this.renderMode === RenderMode.CANVAS) {
        this.ctx.save()
        this.ctx.lineCap = 'square'
      }

      const result = this.rc.path(path, this.parseStyleConfig(rect, svgTransform))
      if (this.renderMode === RenderMode.SVG && result) {
        // same as for the canvas context, use square line-cap instead of default butt here
        result.setAttribute('stroke-linecap', 'square')
      }
      this.postProcessElement(rect, result)

      if (this.renderMode === RenderMode.CANVAS) {
        this.ctx.restore()
      }
    }
  }

  /**
   * @private
   * @param {SVGImageElement} svgImage
   * @param {SVGTransform?} svgTransform
   */
  drawImage(svgImage, svgTransform) {
    const href = svgImage.href.baseVal
    const x = svgImage.x.baseVal.value
    const y = svgImage.y.baseVal.value
    let width, height
    if (svgImage.getAttribute('width') && svgImage.getAttribute('height')) {
      width = svgImage.width.baseVal.value
      height = svgImage.height.baseVal.value
    }
    if (href.startsWith('data:') && href.indexOf('image/svg+xml') !== -1) {
      // data:[<media type>][;charset=<character set>][;base64],<data>
      const dataUrlRegex = /^data:([^,]*),(.*)/
      const match = dataUrlRegex.exec(href)
      if (match.length > 2) {
        const meta = match[1]
        let svgString = match[2]
        const isBase64 = meta.indexOf('base64') !== -1
        const isUtf8 = meta.indexOf('utf8') !== -1
        if (isBase64) {
          svgString = btoa(svgString)
        }
        if (!isUtf8) {
          svgString = decodeURIComponent(svgString)
        }
        const parser = new DOMParser()
        const doc = parser.parseFromString(svgString, 'image/svg+xml')
        const svg = doc.firstElementChild

        let matrix = this.svg.createSVGMatrix().translate(x, y)
        matrix = svgTransform ? svgTransform.matrix.multiply(matrix) : matrix

        this.processRoot(svg, this.svg.createSVGTransformFromMatrix(matrix), width, height)
        return
      }
    } else {
      let matrix = this.svg.createSVGMatrix().translate(x, y)
      matrix = svgTransform ? svgTransform.matrix.multiply(matrix) : matrix
      if (this.renderMode === RenderMode.CANVAS) {
        // we just draw the image 'as is' into the canvas
        const dx = matrix.e
        const dy = matrix.f
        const img = new Image()
        img.onload = () => {
          this.ctx.drawImage(img, dx, dy)
        }
        img.src = href
      } else {
        const imageClone = svgImage.cloneNode()
        const container = document.createElementNS('http://www.w3.org/2000/svg', 'g')
        this.applyGlobalTransform(svgTransform, container)
        container.appendChild(imageClone)
        this.postProcessElement(svgImage, container)
      }
    }
  }

  /**
   * @private
   * @param {SVGTextElement} text
   * @param {SVGTransform?} svgTransform
   */
  drawText(text, svgTransform) {
    if (this.renderMode === RenderMode.SVG) {
      const container = document.createElementNS('http://www.w3.org/2000/svg', 'g')
      container.setAttribute('class', 'text-container')
      this.applyGlobalTransform(svgTransform, container)
      const textClone = text.cloneNode(true)
      if (textClone.transform.baseVal.numberOfItems > 0) {
        // remove transformation, since it is transformed globally by its parent container
        textClone.transform.baseVal.clear()
      }
      textClone.setAttribute('font-family', this.fontFamily)
      container.appendChild(textClone)
      this.postProcessElement(text, container)
      return
    }

    this.ctx.save()

    let textLocation = new Point(this.getLengthInPx(text.x), this.getLengthInPx(text.y))

    // text style
    this.ctx.font = this.getCssFont(text, svgTransform)
    const style = this.parseStyleConfig(text, svgTransform)
    if (style.fill) {
      this.ctx.fillStyle = style.fill
    }
    const stroke = this.getEffectiveAttribute(text, 'stroke')
    const hasStroke = stroke != 'none'
    if (hasStroke) {
      this.ctx.strokeStyle = style.stroke
      this.ctx.lineWidth = this.convertToPixelUnit(this.getEffectiveAttribute(text, 'stroke-width'))
    }

    const textAnchor = this.getEffectiveAttribute(text, 'text-anchor', this.$useElementContext)
    if (textAnchor) {
      this.ctx.textAlign = textAnchor !== 'middle' ? textAnchor : 'center'
    }

    // apply the global transform
    this.applyGlobalTransform(svgTransform)

    // consider dx/dy of the text element
    const dx = this.getLengthInPx(text.dx)
    const dy = this.getLengthInPx(text.dy)
    this.ctx.translate(dx, dy)

    if (text.childElementCount === 0) {
      this.ctx.fillText(
        this.getTextContent(text),
        textLocation.x,
        textLocation.y,
        text.getComputedTextLength()
      )
      if (hasStroke) {
        this.ctx.strokeText(
          this.getTextContent(text),
          textLocation.x,
          textLocation.y,
          text.getComputedTextLength()
        )
      }
    } else {
      const children = this.getNodeChildren(text)
      for (let i = 0; i < children.length; i++) {
        const child = children[i]
        if (child.tagName === 'tspan') {
          textLocation = new Point(this.getLengthInPx(child.x), this.getLengthInPx(child.y))
          const dx = this.getLengthInPx(child.dx)
          const dy = this.getLengthInPx(child.dy)
          this.ctx.translate(dx, dy)
          this.ctx.fillText(this.getTextContent(child), textLocation.x, textLocation.y)
          if (hasStroke) {
            this.ctx.strokeText(this.getTextContent(child), textLocation.x, textLocation.y)
          }
        }
      }
    }

    this.ctx.restore()
  }

  /**
   * Retrieves the text content from a text content element (text, tspan, ...)
   * @private
   * @param {SVGTextContentElement} element
   * @returns {string}
   */
  getTextContent(element) {
    let content = element.textContent
    if (this.shouldNormalizeWhitespace(element)) {
      content = content.replace(/[\n\r\t ]+/g, ' ').trim()
    } else {
      content = content.replace(/\r\n|[\n\r\t]/g, ' ')
    }
    return content
  }

  /**
   * Determines whether the given element has default white-space handling, i.e. normalization.
   * Returns false if the element (or an ancestor) has xml:space='preserve'
   * @private
   * @param {SVGElement} element
   * @returns {boolean}
   */
  shouldNormalizeWhitespace(element) {
    let xmlSpaceAttribute = null
    while (element !== null && element !== this.$svg && xmlSpaceAttribute === null) {
      xmlSpaceAttribute = element.getAttribute('xml:space')
      if (xmlSpaceAttribute === null) {
        element = element.parentNode
      }
    }
    return xmlSpaceAttribute !== 'preserve' // no attribute is also default handling
  }

  /**
   * @private
   * @param {SVGAnimatedLengthList} svgLengthList
   * @return {number} length in pixels
   */
  getLengthInPx(svgLengthList) {
    if (svgLengthList && svgLengthList.baseVal.numberOfItems > 0) {
      return svgLengthList.baseVal.getItem(0).value
    }
    return 0
  }

  /**
   * @private
   * @param {SVGTextElement} text
   * @param {SVGTransform?} svgTransform
   * @return {string}
   */
  getCssFont(text, svgTransform) {
    let cssFont = ''
    const fontStyle = this.getEffectiveAttribute(text, 'font-style', this.$useElementContext)
    if (fontStyle) {
      cssFont += fontStyle
    }
    const fontWeight = this.getEffectiveAttribute(text, 'font-weight', this.$useElementContext)
    if (fontWeight) {
      cssFont += ` ${fontWeight}`
    }
    let fontSize = this.getEffectiveAttribute(text, 'font-size', this.$useElementContext)
    if (fontSize) {
      cssFont += ` ${fontSize}`
    }
    if (this.fontFamily) {
      cssFont += ` ${this.fontFamily}`
    } else {
      const fontFamily = this.getEffectiveAttribute(text, 'font-family', this.$useElementContext)
      if (fontFamily) {
        cssFont += ` ${fontFamily}`
      }
    }

    cssFont = cssFont.trim()
    return cssFont
  }

  /**
   * Returns the Node's children, since Node.prototype.children is not available on all browsers.
   * https://developer.mozilla.org/en-US/docs/Web/API/ParentNode/children
   * @private
   * @param {Node} element
   * @returns {Array}
   */
  getNodeChildren(element) {
    if (typeof element.children !== 'undefined') {
      return element.children
    }
    let i = 0
    let node
    const nodes = element.childNodes
    const children = []
    while ((node = nodes[i++])) {
      if (node.nodeType === 1) {
        children.push(node)
      }
    }
    return children
  }
}

class SvgTextures {
  static get pencilTextureFilter() {
    const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter')
    filter.setAttribute('id', 'pencilTextureFilter')
    filter.setAttribute('x', '0%')
    filter.setAttribute('y', '0%')
    filter.setAttribute('width', '100%')
    filter.setAttribute('height', '100%')
    filter.setAttribute('filterUnits', 'objectBoundingBox')

    const feTurbulence = document.createElementNS('http://www.w3.org/2000/svg', 'feTurbulence')
    feTurbulence.setAttribute('type', 'fractalNoise')
    feTurbulence.setAttribute('baseFrequency', '2')
    feTurbulence.setAttribute('numOctaves', '5')
    feTurbulence.setAttribute('stitchTiles', 'stitch')
    feTurbulence.setAttribute('result', 'f1')
    filter.appendChild(feTurbulence)

    const feColorMatrix = document.createElementNS('http://www.w3.org/2000/svg', 'feColorMatrix')
    feColorMatrix.setAttribute('type', 'matrix')
    feColorMatrix.setAttribute('values', '0 0 0 0 0, 0 0 0 0 0, 0 0 0 0 0, 0 0 0 -1.5 1.5')
    feColorMatrix.setAttribute('result', 'f2')
    filter.appendChild(feColorMatrix)

    const feComposite = document.createElementNS('http://www.w3.org/2000/svg', 'feComposite')
    feComposite.setAttribute('operator', 'in')
    feComposite.setAttribute('in', 'SourceGraphic')
    feComposite.setAttribute('in2', 'f2')
    feComposite.setAttribute('result', 'f3')
    filter.appendChild(feComposite)

    return filter
  }
}
