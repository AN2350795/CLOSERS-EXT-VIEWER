import test_particle_dof_motion_source_browser as source_browser


class ParticleAdditiveMotionSourceBrowserTests(source_browser.ParticleDofMotionSourceBrowserTests):
    checks_script='particle_additive_motion_source_checks.js'
    animation_name='MOTION_STRIKER_EMOTION_DANCE.XMD'
    clip_name='EMOTION_DANCE'

    def check_source_conditions(self,entries):
        self.assertTrue(any(e['conditions'].get('m_vecShowEffectCustomID')=={'1':13} for e in entries))
        self.assertTrue(all(e['state_speed']==.5 for e in entries))

    def source_entries(self,raw):
        names={'PE_SPOT_LIGHT_MAIN','PE_SPOT_LIGHT_MUSIC_NOTE_01','PE_SPOT_LIGHT_MUSIC_NOTE_02'}
        particles=[e for e in raw if e.get('particle_name') in names and e['state']=='USN_EMOTION_DANCE']
        self.assertEqual({e['particle_name'] for e in particles},names)
        self.assertTrue(all(e['particle']['dof_additive_plane'] for e in particles))
        selected={e['key'] for e in particles}
        selected.update(e['key'] for e in raw if e['kind']=='equipment' and e['state']=='USN_EMOTION_DANCE' and not e.get('conditions'))
        return self.with_parents(raw,selected)
