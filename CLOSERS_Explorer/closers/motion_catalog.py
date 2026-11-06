"""Source registrations for discovery, independent of event inheritance."""
from collections import defaultdict

from .motion_converts import SOURCES


def build(tables, characters):
    result = defaultdict(list)
    for source, rows in tables.items():
        if source not in SOURCES:
            continue
        for character in characters:
            selected = defaultdict(set)
            for group, who, state, clip in rows:
                if type(group) is not int or group <= 0 or who not in ('GUST_INVALID', 'GUST_USER_' + character):
                    continue
                if not isinstance(state, str) or not isinstance(clip, str) or not clip:
                    continue
                selected[group, state, who].add(clip)
            for group, state in sorted({(g, s) for g, s, _ in selected}):
                who = 'GUST_USER_' + character if (group, state, 'GUST_USER_' + character) in selected else 'GUST_INVALID'
                clips = selected[group, state, who]
                for clip in sorted(clips):
                    result[character, clip].append(dict(source=source, type=SOURCES[source], group=group,
                        state=state, character=who, ambiguous=len(clips) != 1))
    return dict(result)


def decorate(clips, character, registrations):
    # Parsed metadata is shared by hash. Never modify cached clip dictionaries.
    result = []
    for clip in clips:
        links = registrations.get((character, clip['name']), [])
        kinds = sorted({'town' if link['type'] == 'SCT_TOWN_MOTION' else 'dungeon' for link in links})
        result.append(dict(clip, motion_registrations=links, motion_categories=kinds))
    return result
