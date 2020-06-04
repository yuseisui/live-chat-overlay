import { settingsStorage } from '@/services/settings';

describe('dummy', () => {
    it('should pass', () => {
        expect(settingsStorage.get()).toEqual({
            numberOfLines: 15,
            flowTimeInSec: 10,
            messageSettings: {
                guest: {
                    color: 'white',
                    weight: 700,
                    opacity: 0.8,
                    bgColor: 'transparent',
                    strokeColor: 'black',
                    strokeWidth: 0.03,
                    numberOfLines: 1,
                    authorDisplay: 'none',
                },
                member: {
                    weight: 700,
                    opacity: 0.8,
                    bgColor: 'transparent',
                    strokeColor: 'black',
                    strokeWidth: 0.03,
                    numberOfLines: 1,
                    authorDisplay: 'none',
                    color: '#2ba640',
                },
                you: {
                    color: 'white',
                    weight: 700,
                    opacity: 0.8,
                    bgColor: 'transparent',
                    strokeColor: 'black',
                    strokeWidth: 0.03,
                    numberOfLines: 1,
                    authorDisplay: 'none',
                },
                moderator: {
                    weight: 700,
                    opacity: 0.8,
                    bgColor: 'transparent',
                    strokeColor: 'black',
                    strokeWidth: 0.03,
                    numberOfLines: 1,
                    color: '#5e84f1',
                    authorDisplay: 'all',
                },
                owner: {
                    weight: 700,
                    opacity: 0.8,
                    strokeColor: 'black',
                    strokeWidth: 0.03,
                    numberOfLines: 1,
                    color: 'white',
                    bgColor: '#ffd600',
                    authorDisplay: 'all',
                },
                verified: {
                    weight: 700,
                    opacity: 0.8,
                    strokeColor: 'black',
                    strokeWidth: 0.03,
                    numberOfLines: 1,
                    color: '#E9E9E9',
                    bgColor: '#606060',
                    authorDisplay: 'all',
                },
                membership: {
                    color: 'white',
                    weight: 700,
                    opacity: 0.8,
                    bgColor: 'transparent',
                    strokeColor: 'black',
                    strokeWidth: 0.03,
                    numberOfLines: 1,
                    authorDisplay: 'all',
                },
                'super-chat': {
                    color: 'white',
                    weight: 700,
                    opacity: 0.8,
                    bgColor: 'transparent',
                    strokeColor: 'black',
                    strokeWidth: 0.03,
                    numberOfLines: 2,
                    authorDisplay: 'all',
                },
            },
        });
    });
});