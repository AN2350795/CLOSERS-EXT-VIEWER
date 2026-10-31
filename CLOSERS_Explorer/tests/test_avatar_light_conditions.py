import unittest
from pathlib import Path

from closers.avatar_light_conditions import TYPES, SOURCES, read_rules, evaluate, diagnose
from test_avatar_lighting import Data
from test_game_names import table


def row(condition=211, target=211, count=2, groups='211,', extra=''):
    return ('CVN_TEST', condition, '"GUST_USER_REAPER",', extra, groups, count, 0, 0, 0, 0, 0, 0, target, 0, '')


def source(item, part, appearance=None):
    return dict(item_id=item, appearance_key=appearance or str(item), item_part=part,
                model_group=dict(kind='avatar', character='REAPER', part=part, family='RARE'))


class AvatarLightConditionsTests(unittest.TestCase):
    def fixture(self, rows=None):
        return {SOURCES[0]: table(TYPES, rows if rows is not None else [row()]),
                SOURCES[1]: table((4, 5), [(211, 11), (999, 90)]),
                SOURCES[2]: table((4, 5), [(211, 12), (211, 11)]), SOURCES[3]: table((4, 5), [])}

    def test_explicit_light_column_and_sharded_item_membership(self):
        values=self.fixture([row(), row(1411, 0, 7), row(212, 211)])
        rules=read_rules(Data(values))
        self.assertEqual(len(rules), 2)
        self.assertEqual(rules[0]['item_ids'], [11, 12])
        report=evaluate(rules, [source(11,'HAIR'), source(12,'HAND')])
        self.assertEqual(report['status'], 'ready'); self.assertEqual(report['target_group'], 211)
        self.assertEqual(len(report['candidates']), 2)  # Same target is not ambiguity.
        self.assertEqual(report['scope'], 'preview-items-only')

    def test_skin_light_column_is_independent_from_motion_light_and_skill_effect(self):
        skill=list(row(1343,0));skill[10]=1343
        light=list(row(1351,1343,7));light[10]=0
        rules=read_rules(Data(self.fixture([skill,light])))
        self.assertEqual([(r['condition_id'],r['target_group'],r['required_count']) for r in rules],[(1351,1343,7)])

    def test_meshes_and_type_aliases_do_not_inflate_item_count(self):
        rules=read_rules(Data(self.fixture()))
        report=evaluate(rules, [source(11,'HAIR'), source(11,'HAIR','11:type2')])
        self.assertEqual(report['status'], 'incomplete')
        self.assertEqual(report['candidates'][0]['matched_count'], 1)
        self.assertEqual(evaluate(rules, [source(90,'HAIR')])['candidates'], [])

    def test_unknown_item_conflicting_slots_and_extra_conditions_are_deferred(self):
        rules=read_rules(Data(self.fixture()))
        for sources in ([source(11,'HAIR'), source(12,'HAIR')],
                        [source(11,'ONE_PIECE'), source(12,'UPBODY')],
                        [source(11,'HAIR'), source(12,'HAND'), dict(model_group=dict(kind='avatar',character='REAPER',part='FOOT'))]):
            with self.subTest(sources=sources):
                report=evaluate(rules,sources)
                self.assertEqual(report['status'],'unverified');self.assertIsNone(report['target_group'])
        rules[0]['extra_condition']='OTHER_CONDITION'
        self.assertEqual(evaluate(rules,[source(11,'HAIR'),source(12,'HAND')])['candidates'][0]['status'],'unverified')

    def test_character_and_multiple_light_conditions(self):
        rules=read_rules(Data(self.fixture([row(),row(212,203)])))
        sources=[source(11,'HAIR'),source(12,'HAND')]
        self.assertEqual(evaluate(rules,sources)['status'],'ambiguous')
        sources[1]['model_group']['character']='CASTER'
        self.assertEqual(evaluate(rules,sources)['status'],'unavailable')
        for s in sources:s['model_group']['character']='CASTER'
        self.assertEqual(evaluate(rules,sources)['candidates'],[])

    def test_missing_invalid_and_unsupported_sources(self):
        self.assertEqual(read_rules(Data({})),[])
        for change in ({SOURCES[0]:table((5,),[(1,)])}, {SOURCES[2]:table((5,),[(1,)])},
                       {SOURCES[0]:table(TYPES,[row(groups='211,unknown')])},
                       {SOURCES[0]:table(TYPES,[row(count=0)])}):
            with self.subTest(change=change),self.assertRaises(ValueError):read_rules(Data(self.fixture()|change))
        values=self.fixture();del values[SOURCES[2]]
        with self.assertRaises(ValueError):read_rules(Data(values))

    def test_diagnostic_failure_is_isolated_and_non_avatar_skips_source_reads(self):
        class CachedData(Data):
            def cached(self,key,build,persistent=False):return build()
        report=diagnose(CachedData({SOURCES[0]:table((5,),[(1,)])}),[source(11,'HAIR')])
        self.assertEqual(report['status'],'unavailable');self.assertTrue(report['reason'])
        # A scene with no avatars must not try to read these invalid tables.
        self.assertEqual(diagnose(None,[dict(model_group=dict(kind='npc'))])['status'],'unavailable')

    def test_local_source_netherworld_and_common_skin_light_connections(self):
        from closers.catalog import Catalog
        from closers.loading import LoadingData
        workspace=Path(__file__).resolve().parents[2]/'results'
        if not (workspace/'catalog.sqlite3').exists():self.skipTest('Local source unavailable')
        rules=read_rules(LoadingData(Catalog(workspace)))
        nether=[r for r in rules if r['target_group']==211]
        self.assertEqual({r['condition_id'] for r in nether},{211,212})
        self.assertEqual({r['required_count'] for r in nether},{10})
        self.assertTrue(all(len(r['item_ids'])==136 for r in nether))
        self.assertEqual(len(rules),6)
        self.assertEqual({(r['condition_id'],r['target_group'],r['required_count']) for r in rules},
                         {(201,201,10),(203,203,10),(211,211,10),(212,211,10),(1351,1343,7),(1411,1411,7)})
        # Exercise the real scene endpoint path, including shared accessory
        # composition and server-supplied item identity, without rendering.
        from closers.model_items import AvatarItems
        from closers.model_library import Models
        from closers.model_groups import classify
        catalog=Catalog(workspace);items=AvatarItems(catalog);models=Models(catalog)
        selected={}
        for item in items.definitions():
            if item['character']=='REAPER' and item['item_id'] in nether[0]['item_ids'] and classify(item['model_name'])['variant']=='BASE':
                selected.setdefault(item['item_id'],item)
        ids=[];keys={}
        for item in selected.values():
            matches=models.matches(item['model_name'])
            if len(matches)!=1:continue
            entry=matches[0]['id'];ids.append(entry);keys[str(entry)]=item['key']
        self.assertEqual(len(ids),8)
        scene=models.scene(ids,items=keys);report=scene['lighting_conditions']
        self.assertEqual(report['status'],'incomplete')
        candidates=[r for r in report['candidates'] if r['target_group']==211]
        self.assertTrue(candidates)
        self.assertEqual({r['matched_count'] for r in candidates},{8})
        extras={r['item_id']:r for r in report['additional_items']}
        self.assertEqual(set(extras),{1499000164,1799000161})
        self.assertEqual(extras[1499000164]['part'],'ACC_BODY_WING')
        self.assertEqual(extras[1799000161]['part'],'ACC_RING_RIGHT')
        for selected,count,status in [([1499000164],9,'incomplete'),([1499000164,1799000161],10,'ready'),([],8,'incomplete')]:
            changed=models.scene(ids,items=keys,condition_items=selected)
            self.assertEqual(changed['lighting_conditions']['status'],status)
            self.assertEqual({r['matched_count'] for r in changed['lighting_conditions']['candidates'] if r['target_group']==211},{count})
            self.assertEqual(scene['meshes'],changed['meshes'])
        with self.assertRaises(ValueError):models.scene(ids,items=keys,condition_items=[1317000161])  # ordinary hair is not additional gear
