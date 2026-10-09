import unittest
import numpy as np
from radio_diarization import cluster_voices, assign_words, group_turns

class RadioDiarizationTests(unittest.TestCase):
    def test_single_voice_is_not_forced_into_two(self):
        labels=cluster_voices(np.array([[1.,0.,0.],[.98,.02,0.],[.99,0.,.01]]))
        self.assertEqual(len(set(labels)),1)

    def test_two_acoustic_voices(self):
        labels=cluster_voices(np.array([[1.,0.,0.],[.97,.03,0.],[0.,1.,0.],[.02,.98,0.]]))
        self.assertEqual(labels[0],labels[1])
        self.assertEqual(labels[2],labels[3])
        self.assertNotEqual(labels[0],labels[2])

    def test_word_boundary_can_split_one_asr_segment(self):
        words=[{'start':0.,'end':.8,'text':'Box.'},{'start':1.,'end':1.8,'text':' Copy.'},{'start':2.,'end':2.8,'text':' Thanks.'}]
        windows=[{'start':0.,'end':.8,'speaker':9},{'start':1.,'end':1.8,'speaker':3},{'start':2.,'end':2.8,'speaker':3}]
        turns=group_turns(assign_words(words,windows))
        self.assertEqual([t['speaker'] for t in turns],['Speaker 1','Speaker 2'])
        self.assertEqual(turns[1]['text'],'Copy. Thanks.')
        self.assertEqual(turns[1]['end'],2.8)

    def test_silence_and_no_windows(self):
        self.assertEqual(cluster_voices(np.empty((0,3))),[])
        self.assertEqual(group_turns([]),[])
        turn=group_turns(assign_words([{'start':0.,'end':1.,'text':'Unknown.'}],[]))[0]
        self.assertEqual(turn['speaker'],'Unknown speaker')

if __name__=='__main__':unittest.main()
