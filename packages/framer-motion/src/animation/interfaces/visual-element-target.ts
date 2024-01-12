import { transformProps } from "../../render/html/utils/transform"
import type { AnimationTypeState } from "../../render/utils/animation-state"
import type { VisualElement } from "../../render/VisualElement"
import type { Target, TargetAndTransition, Transition } from "../../types"
import { optimizedAppearDataAttribute } from "../optimized-appear/data-id"
import type { VisualElementAnimationOptions } from "./types"
import { animateMotionValue } from "./motion-value"
import { isWillChangeMotionValue } from "../../value/use-will-change/is"
import { setTarget } from "../../render/utils/setters"
import { AnimationPlaybackControls } from "../types"
import { getValueTransition } from "../utils/transitions"
import { MotionValue } from "../../value"
import { frame } from "../../frameloop"

/**
 * Decide whether we should block this animation. Previously, we achieved this
 * just by checking whether the key was listed in protectedKeys, but this
 * posed problems if an animation was triggered by afterChildren and protectedKeys
 * had been set to true in the meantime.
 */
function shouldBlockAnimation(
    { protectedKeys, needsAnimating }: AnimationTypeState,
    key: string
) {
    const shouldBlock =
        protectedKeys.hasOwnProperty(key) && needsAnimating[key] !== true

    needsAnimating[key] = false
    return shouldBlock
}

function hasKeyframesChanged(value: MotionValue, target: Target) {
    const current = value.get()

    if (Array.isArray(target)) {
        for (let i = 0; i < target.length; i++) {
            if (target[i] !== current) return true
        }
    } else {
        return current !== target
    }
}

export function animateTarget(
    visualElement: VisualElement,
    definition: TargetAndTransition,
    { delay = 0, transitionOverride, type }: VisualElementAnimationOptions = {}
): AnimationPlaybackControls[] {
    let {
        transition = visualElement.getDefaultTransition(),
        transitionFrom,
        transitionEnd,
        ...target
    } = visualElement.makeTargetAnimatable(definition)

    const willChange = visualElement.getValue("willChange")

    if (transitionOverride) transition = transitionOverride

    const animations: AnimationPlaybackControls[] = []

    const animationTypeState =
        type &&
        visualElement.animationState &&
        visualElement.animationState.getState()[type]

    for (const key in target) {
        const value = visualElement.getValue(key)
        const valueTarget = target[key]

        if (
            !value ||
            valueTarget === undefined ||
            (animationTypeState &&
                shouldBlockAnimation(animationTypeState, key))
        ) {
            continue
        }

        let transitionFromType: Transition | undefined
        if (transitionFrom) {
            if (value.currentAnimationType) {
                transitionFromType = transitionFrom[value.currentAnimationType]
            } else {
                const initialType = visualElement.getProps().initial
                    ? "initial"
                    : "animate"
                transitionFromType = transitionFrom[initialType]
            }
        }

        const valueTransition = {
            delay,
            elapsed: 0,
            ...getValueTransition(transitionFromType || transition || {}, key),
        }

        /**
         * If this is the first time a value is being animated, check
         * to see if we're handling off from an existing animation.
         */
        if (window.HandoffAppearAnimations) {
            const appearId =
                visualElement.getProps()[optimizedAppearDataAttribute]

            if (appearId) {
                const elapsed = window.HandoffAppearAnimations(
                    appearId,
                    key,
                    value,
                    frame
                )

                if (elapsed !== null) {
                    valueTransition.elapsed = elapsed
                    valueTransition.isHandoff = true
                }
            }
        }

        let canSkip =
            !valueTransition.isHandoff &&
            !hasKeyframesChanged(value, valueTarget)

        if (
            valueTransition.type === "spring" &&
            (value.getVelocity() || valueTransition.velocity)
        ) {
            canSkip = false
        }

        /**
         * Temporarily disable skipping animations if there's an animation in
         * progress. Better would be to track the current target of a value
         * and compare that against valueTarget.
         */
        if (value.animation) {
            canSkip = false
        }

        if (canSkip) continue

        value.start(
            animateMotionValue(
                key,
                value,
                valueTarget,
                visualElement.shouldReduceMotion && transformProps.has(key)
                    ? { type: false }
                    : valueTransition
            )
        )

        value.currentAnimationType = type || "animate"

        const animation = value.animation!

        if (isWillChangeMotionValue(willChange)) {
            willChange.add(key)
            animation.then(() => willChange.remove(key))
        }

        animations.push(animation)
    }

    if (transitionEnd) {
        Promise.all(animations).then(() => {
            transitionEnd && setTarget(visualElement, transitionEnd)
        })
    }

    return animations
}
