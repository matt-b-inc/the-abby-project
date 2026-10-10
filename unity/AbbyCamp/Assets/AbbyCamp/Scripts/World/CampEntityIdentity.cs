using UnityEngine;

namespace AbbyCamp.World
{
    /// <summary>Content identity stays on the gameplay root through every model replacement.</summary>
    public sealed class CampEntityIdentity : MonoBehaviour
    {
        [SerializeField] private string contentId;
        public string ContentId => contentId;
        public void Configure(string id) => contentId = id;
    }
}
