using UnityEngine;

namespace AbbyCamp.Presentation
{
    /// <summary>Asset-independent feedback using particles and a short synthesized chime.</summary>
    public sealed class RewardReaction : MonoBehaviour
    {
        [SerializeField] private Material particleMaterial;
        private ParticleSystem sparkles;
        private AudioSource audioSource;
        private AudioClip chime;

        public void Configure(Material material) => particleMaterial = material;

        public void Play()
        {
            if (sparkles == null) CreateEffects();
            sparkles.Play();
            sparkles.Emit(22);
            audioSource.PlayOneShot(chime, .3f);
        }

        private void CreateEffects()
        {
            var effectObject = new GameObject("Reward sparkles");
            effectObject.transform.SetParent(transform, false);
            effectObject.transform.localPosition = Vector3.up * .65f;
            sparkles = effectObject.AddComponent<ParticleSystem>();
            var main = sparkles.main;
            main.playOnAwake = false;
            main.loop = false;
            main.startLifetime = .8f;
            main.startSpeed = 1.8f;
            main.startSize = .085f;
            main.startColor = new ParticleSystem.MinMaxGradient(new Color(1f, .79f, .23f), new Color(.46f, .92f, .9f));
            main.gravityModifier = .3f;
            main.simulationSpace = ParticleSystemSimulationSpace.World;
            var emission = sparkles.emission;
            emission.enabled = false;
            var shape = sparkles.shape;
            shape.shapeType = ParticleSystemShapeType.Sphere;
            shape.radius = .4f;
            // A serialized asset keeps the particle shader in player builds; runtime shader lookup
            // can fail after shader stripping. Without custom art, retain Unity's default material.
            if (particleMaterial != null)
                sparkles.GetComponent<ParticleSystemRenderer>().sharedMaterial = particleMaterial;
            sparkles.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
            audioSource = gameObject.AddComponent<AudioSource>();
            audioSource.playOnAwake = false;
            audioSource.spatialBlend = .1f;
            const int sampleRate = 22050;
            var samples = new float[(int)(sampleRate * .48f)];
            for (var i = 0; i < samples.Length; i++)
            {
                var t = (float)i / sampleRate;
                var frequency = t < .13f ? 523.25f : t < .26f ? 659.25f : 783.99f;
                samples[i] = Mathf.Sin(t * frequency * Mathf.PI * 2f) * Mathf.Exp(-t * 7f) * .25f;
            }
            chime = AudioClip.Create("Camp reward chime", samples.Length, 1, sampleRate, false);
            chime.SetData(samples, 0);
        }

        private void OnDestroy()
        {
            if (chime != null) Destroy(chime);
        }
    }
}
