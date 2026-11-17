#!/usr/bin/env python3
"""Shared helpers for all MonGen Blender scripts."""
from __future__ import annotations
import math
from mathutils import Vector


class Mulberry32:
    def __init__(self, seed: int): self.state = seed & 0xFFFFFFFF
    def next_float(self) -> float:
        self.state = (self.state + 0x6D2B79F5) & 0xFFFFFFFF
        value = self.state
        value = ((value ^ (value >> 15)) * ((value | 1) & 0xFFFFFFFF)) & 0xFFFFFFFF
        value ^= (value + (((value ^ (value >> 7)) * ((value | 61) & 0xFFFFFFFF)) & 0xFFFFFFFF)) & 0xFFFFFFFF
        return ((value ^ (value >> 14)) & 0xFFFFFFFF) / 4294967296.0


def mix32(value: int) -> int:
    value &= 0xFFFFFFFF
    value = ((value ^ (value >> 16)) * 0x7FEB352D) & 0xFFFFFFFF
    value = ((value ^ (value >> 15)) * 0x846CA68B) & 0xFFFFFFFF
    return (value ^ (value >> 16)) & 0xFFFFFFFF


def source_to_blender(point: tuple) -> Vector:
    """Convert DNA source coords (x right, y depth, z up) to Blender (x right, y forward, z up)."""
    return Vector((point[0], -point[2], point[1]))


# Per-archetype art direction. Key: (skeleton, archetype_index 0-2)
ARCHETYPE_CONFIG: dict[tuple, dict] = {
    ("Biped", 0): {"timing_multiplier": 0.70, "preferred_parts": ["Armor", "Horn"],
                   "palette_temp_bias": -0.08, "secondary_parts": []},
    ("Biped", 1): {"timing_multiplier": 1.30, "preferred_parts": ["Fin", "Spine"],
                   "palette_temp_bias": +0.04, "secondary_parts": ["tail", "ear"]},
    ("Biped", 2): {"timing_multiplier": 1.50, "preferred_parts": ["Ear", "Flame"],
                   "palette_temp_bias": +0.10, "secondary_parts": ["ear", "tail", "wing"]},
    ("Quadruped", 0): {"timing_multiplier": 0.75, "preferred_parts": ["Armor", "Horn"],
                       "palette_temp_bias": -0.06, "secondary_parts": ["tail"]},
    ("Quadruped", 1): {"timing_multiplier": 0.85, "preferred_parts": ["Armor", "Spine"],
                       "palette_temp_bias": -0.04, "secondary_parts": []},
    ("Quadruped", 2): {"timing_multiplier": 1.10, "preferred_parts": ["Leaf", "Ear"],
                       "palette_temp_bias": +0.06, "secondary_parts": ["tail", "ear"]},
    ("Serpentine", 0): {"timing_multiplier": 1.15, "preferred_parts": ["Fin", "Crystal"],
                        "palette_temp_bias": -0.04, "secondary_parts": ["fin"]},
    ("Serpentine", 1): {"timing_multiplier": 1.25, "preferred_parts": ["Fin", "Spine"],
                        "palette_temp_bias": +0.02, "secondary_parts": ["fin"]},
    ("Serpentine", 2): {"timing_multiplier": 0.90, "preferred_parts": ["Armor", "Horn"],
                        "palette_temp_bias": -0.08, "secondary_parts": []},
    ("Avian", 0): {"timing_multiplier": 1.20, "preferred_parts": ["Wing", "Spine"],
                   "palette_temp_bias": -0.04, "secondary_parts": ["wing"]},
    ("Avian", 1): {"timing_multiplier": 0.80, "preferred_parts": ["Wing", "Armor"],
                   "palette_temp_bias": +0.02, "secondary_parts": ["wing"]},
    ("Avian", 2): {"timing_multiplier": 1.40, "preferred_parts": ["Wing", "Flame"],
                   "palette_temp_bias": +0.08, "secondary_parts": ["wing", "tail"]},
    ("Floating", 0): {"timing_multiplier": 0.65, "preferred_parts": ["Crystal", "Flame"],
                      "palette_temp_bias": +0.04, "secondary_parts": ["flame"]},
    ("Floating", 1): {"timing_multiplier": 1.10, "preferred_parts": ["Spine", "Crystal"],
                      "palette_temp_bias": 0.00, "secondary_parts": []},
    ("Floating", 2): {"timing_multiplier": 0.55, "preferred_parts": ["Armor", "Crystal"],
                      "palette_temp_bias": -0.06, "secondary_parts": []},
}

# Secondary motion parameters per part type: (lag_frames, damping_factor)
SECONDARY_MOTION_DAMPING: dict[str, tuple[int, float]] = {
    "tail":    (1, 0.52),
    "ear":     (1, 0.38),
    "wing":    (2, 0.55),
    "fin":     (1, 0.44),
    "flame":   (1, 0.35),
    "spine":   (2, 0.65),
    "leaf":    (1, 0.42),
    "crystal": (2, 0.60),
}


def get_archetype_config(skeleton: str, seed: int) -> dict:
    rng = Mulberry32((seed ^ 0x0D1A7E25) & 0xFFFFFFFF)
    archetype_index = min(2, int(rng.next_float() * 3))
    return ARCHETYPE_CONFIG.get((skeleton, archetype_index), {"timing_multiplier": 1.0, "palette_temp_bias": 0.0})
